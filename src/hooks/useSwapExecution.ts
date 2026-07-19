import { useState, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import type { Signer } from 'ethers';
import { ADDRESSES, ORVIX_ABI, ERC20_ABI, WBNB_ABI } from '../constants/contracts';
import type { TokenInfo, TxInfo, PoolAssessment } from '../types';
import { parseBackendError } from './useQuote';
import { useSettings } from '../contexts/SettingsContext';

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

        // Check current allowance first
        const currentAllowance = await contract.allowance(
          await signer.getAddress(),
          ADDRESSES.ORVIX_AGGREGATOR
        );

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
        await tx.wait();
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
    [getSigner]
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
        const receipt = await tx.wait();

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
    [getSigner, settings.treasury, settings.integrator]
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
        await tx.wait();
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
    [getSigner]
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
        await tx.wait();
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
    [getSigner]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxInfo(null);
    setError(null);
  }, []);

  return { status, txInfo, error, approve, swap, wrapBNB, unwrapWBNB, reset };
}

