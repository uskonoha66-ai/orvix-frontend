import { useState, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import type { Signer, TransactionReceipt } from 'ethers';
import { ADDRESSES, ORVIX_ABI, ERC20_ABI, WBNB_ABI } from '../constants/contracts';
import type { TokenInfo, TxInfo, PoolAssessment } from '../types';
import { parseBackendError } from './useQuote';
import { withRpcRetry, isRateLimitError } from './rpcRetry';
import { useSettings } from '../contexts/SettingsContext';

const RECEIPT_POLL_INTERVAL_MS = 3000;
const RECEIPT_MAX_ATTEMPTS = 40; // ~2 minutes total across retries/fallbacks

/**
 * Waits for a transaction receipt WITHOUT relying solely on the wallet's
 * (e.g. MetaMask's) built-in provider/RPC. MetaMask's default RPC can get
 * rate-limited (error -32005 "Request is being rate limited") especially on
 * public testnet endpoints, which previously made tx.wait() hang or throw
 * even though the transaction itself succeeded on-chain.
 *
 * Instead, this polls eth_getTransactionReceipt manually through
 * withRpcRetry — the same fallback RPC rotation used everywhere else in the
 * app (see rpcRetry.ts / FALLBACK_RPCS) — so a rate-limited or flaky RPC
 * automatically rotates to the next one rather than failing the whole
 * transaction flow.
 */
async function waitForReceiptWithRetry(
  txHash: string,
  preferredRpc?: string
): Promise<TransactionReceipt | null> {
  for (let attempt = 0; attempt < RECEIPT_MAX_ATTEMPTS; attempt++) {
    try {
      const receipt = await withRpcRetry(async (provider) => {
        return provider.getTransactionReceipt(txHash);
      }, preferredRpc);

      if (receipt) return receipt;
      // Not mined yet — wait and poll again
      await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_INTERVAL_MS));
    } catch (e) {
      // Only keep retrying on rate-limit/network errors; anything else
      // (e.g. malformed hash) should surface immediately.
      if (!isRateLimitError(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_INTERVAL_MS));
    }
  }
  throw new Error(
    `Timed out waiting for transaction receipt after ${(RECEIPT_MAX_ATTEMPTS * RECEIPT_POLL_INTERVAL_MS) / 1000}s. ` +
      `The transaction may still confirm — check the explorer using the tx hash.`
  );
}

export function useSwapExecution() {
  const { settings } = useSettings();
  const [status, setStatus] = useState<'idle' | 'approving' | 'swapping' | 'wrapping' | 'unwrapping'>('idle');
  const [txInfo, setTxInfo] = useState<TxInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getSigner = useCallback(async (provider: BrowserProvider): Promise<Signer> => {
    return provider.getSigner();
  }, []);

  const approve = useCallback(
    async (
      token: TokenInfo,
      amountIn: string,
      provider: BrowserProvider
    ): Promise<boolean> => {
      // Skip approve for native tokens
      if (token.isNative) {
        return true;
      }

      setError(null);
      setStatus('approving');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(token.address, ERC20_ABI, signer);
        const ownerAddress = await signer.getAddress();

        // DIAGNOSTIC LOGGING — compare these runtime values against the CLI's
        // known-working call (token address, wallet address, ORVIX_AGGREGATOR)
        // to catch cases where the frontend is silently calling allowance()
        // against a wrong/mismatched contract address, wrong network, or
        // wrong signer — rather than a transient RPC issue. Check via remote
        // debugging (chrome://inspect or Eruda) on the device where approve
        // fails.
        console.log('[Orvix approve] contract target:', await contract.getAddress());
        console.log('[Orvix approve] token.address (input):', token.address);
        console.log('[Orvix approve] owner:', ownerAddress);
        console.log('[Orvix approve] spender (ORVIX_AGGREGATOR):', ADDRESSES.ORVIX_AGGREGATOR);
        try {
          const net = await provider.getNetwork();
          console.log('[Orvix approve] chainId (from wallet provider):', net.chainId.toString());
        } catch (netErr) {
          console.log('[Orvix approve] failed to read network from provider:', netErr);
        }

        // Check current allowance first. Some wallet-injected providers
        // (e.g. certain MetaMask forks/clones) occasionally return an empty
        // "0x" response for eth_call right after a network switch or while
        // their internal RPC cache is catching up — ethers then throws
        // "could not decode result data ... code=BAD_DATA" even though the
        // contract and chain are both correct. This is transient, so we
        // retry a few times with a short delay before giving up, rather
        // than failing the whole approve flow on one flaky read.
        let currentAllowance: bigint | null = null;
        let lastAllowanceError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            currentAllowance = await contract.allowance(ownerAddress, ADDRESSES.ORVIX_AGGREGATOR);
            break;
          } catch (e) {
            lastAllowanceError = e;
            console.log(`[Orvix approve] allowance() attempt ${attempt + 1} failed:`, e);
            if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
          }
        }
        if (currentAllowance === null) {
          throw lastAllowanceError ?? new Error('Failed to read current allowance');
        }

        const amountInWei = parseUnits(amountIn, token.decimals);

        // Skip approve if already have enough allowance
        if (currentAllowance >= amountInWei) {
          setStatus('idle');
          return true;
        }

        // Approve max — matches backend ensure_approved / CLI behavior
        const MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const tx = await contract.approve(ADDRESSES.ORVIX_AGGREGATOR, MAX);
        setTxInfo({ hash: tx.hash, status: 'pending', type: 'approve' });
        await waitForReceiptWithRetry(tx.hash, settings.rpcUrl);
        setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'approve' });
        setStatus('idle');
        return true;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return false;
      }
    },
    [getSigner, settings.rpcUrl]
  );

  /**
   * Executes swapExactInput() using the path that was already built for the
   * SPECIFIC pool the user clicked in the Pool Assessment list (see
   * useQuote's selectPool(), which calls POST /api/build-path-for-pool).
   *
   * `pool.path` and `pool.amountOutMin` must already be populated before
   * calling this — they are NOT derived here and this function does NOT
   * call quoteExactInput() at any point, by design (user picks any pool,
   * not just the auto-selected best one).
   */
  const swap = useCallback(
    async (
      tokenIn: TokenInfo,
      tokenOut: TokenInfo,
      amountIn: string,
      pool: PoolAssessment,
      provider: BrowserProvider
    ): Promise<string | null> => {
      // Validate pool has a path — this means selectPool() successfully
      // fetched it from /api/build-path-for-pool. If this fires, the UI
      // should not have enabled the Swap button in the first place.
      if (!pool.path) {
        setError('Selected pool does not have a valid path yet. Please wait or reselect the pool.');
        return null;
      }

      if (pool.amountOutMin === undefined) {
        setError('Selected pool is missing amountOutMin. Please reselect the pool.');
        return null;
      }

      if (!pool.eligible) {
        setError('Selected pool is not eligible for this swap.');
        return null;
      }

      setError(null);
      setStatus('swapping');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(ADDRESSES.ORVIX_AGGREGATOR, ORVIX_ABI, signer);

        const amountInWei = parseUnits(amountIn, tokenIn.decimals);

        // amountOutMin comes pre-computed from the backend (already accounts
        // for settings.slippageBps at the time the pool was selected — see
        // build-path-for-pool). We use it as-is rather than recomputing here,
        // so the number shown to the user in "Swap Details" matches exactly
        // what gets sent on-chain.
        const amountOutMin = pool.amountOutMin;

        // Match CLI deadline (effectively no expiry)
        const deadline = 9999999999n;

        const txOpts: { value?: bigint } = tokenIn.isNative ? { value: amountInWei } : {};

        const tx = await contract.swapExactInput(
          tokenIn.address,
          tokenOut.address,
          amountInWei,
          amountOutMin,
          await signer.getAddress(),
          deadline,
          pool.path, // path built specifically for this pool via build-path-for-pool
          settings.treasury,
          settings.integrator,
          txOpts
        );

        setTxInfo({ hash: tx.hash, status: 'pending', type: 'swap' });
        const receipt = await waitForReceiptWithRetry(tx.hash, settings.rpcUrl);

        if (receipt?.status === 1) {
          setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'swap' });
          setStatus('idle');
          return tx.hash;
        } else {
          setTxInfo({ hash: tx.hash, status: 'failed', type: 'swap' });
          setError('Transaction Failed');
          setStatus('idle');
          return null;
        }
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return null;
      }
    },
    [getSigner, settings.treasury, settings.integrator, settings.rpcUrl]
  );

  const wrapBNB = useCallback(
    async (amount: string, provider: BrowserProvider): Promise<string | null> => {
      setError(null);
      setStatus('wrapping');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(ADDRESSES.WBNB, WBNB_ABI, signer);
        const amountWei = parseUnits(amount, 18);
        const tx = await contract.deposit({ value: amountWei });
        setTxInfo({ hash: tx.hash, status: 'pending', type: 'wrap' });
        await waitForReceiptWithRetry(tx.hash, settings.rpcUrl);
        setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'wrap' });
        setStatus('idle');
        return tx.hash;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return null;
      }
    },
    [getSigner, settings.rpcUrl]
  );

  const unwrapWBNB = useCallback(
    async (amount: string, provider: BrowserProvider): Promise<string | null> => {
      setError(null);
      setStatus('unwrapping');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(ADDRESSES.WBNB, WBNB_ABI, signer);
        const amountWei = parseUnits(amount, 18);
        const tx = await contract.withdraw(amountWei);
        setTxInfo({ hash: tx.hash, status: 'pending', type: 'unwrap' });
        await waitForReceiptWithRetry(tx.hash, settings.rpcUrl);
        setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'unwrap' });
        setStatus('idle');
        return tx.hash;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return null;
      }
    },
    [getSigner, settings.rpcUrl]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxInfo(null);
    setError(null);
  }, []);

  return { status, txInfo, error, approve, swap, wrapBNB, unwrapWBNB, reset };
}

