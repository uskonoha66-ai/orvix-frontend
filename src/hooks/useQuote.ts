import { useState, useCallback } from 'react';
import { Contract, formatUnits } from 'ethers';
import { withRpcRetry, isRateLimitError } from './rpcRetry';
import { useSettings } from '../contexts/SettingsContext';
import { ADDRESSES, ERC20_ABI } from '../constants/contracts';
import type { TokenInfo, PoolAssessment } from '../types';

function parseBackendError(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const err = e as { reason?: string; message?: string; data?: { message?: string }; code?: string | number };
  if (err.reason) return err.reason;
  if (err.data?.message) return err.data.message;
  const code = err.code;

  // Ethers v6 often wraps raw JSON-RPC provider errors in a single string like:
  //   could not coalesce error (error={ "code": -32603, "message": "..." }, ...)
  // with err.code itself set to a generic string like 'UNKNOWN_ERROR' — the real
  // numeric RPC error code is embedded INSIDE err.message, not at the top level.
  // We extract it here (from either "code": -32603 or a bare -32603 substring)
  // so the checks below can match it regardless of which layer it appears in.
  const nestedCodeMatch = err.message?.match(/"code":\s*(-?\d+)/) ?? err.message?.match(/(-3\d{4})/);
  const nestedCode = nestedCodeMatch ? parseInt(nestedCodeMatch[1], 10) : undefined;
  const effectiveCode = typeof code === 'number' ? code : nestedCode;

  // Standard JSON-RPC error codes (https://www.jsonrpc.org/specification#error_object
  // + Ethereum provider conventions).
  if (effectiveCode === -32005) return 'RPC Rate Limited — Retrying with alternate node...';
  if (effectiveCode === -32603) return 'RPC Internal Error — please try again';
  if (effectiveCode === -32602) return 'Invalid Request Parameters';
  if (effectiveCode === -32601) return 'RPC Method Not Supported';
  if (effectiveCode === -32600) return 'Invalid RPC Request';
  if (effectiveCode === -32000 || effectiveCode === -32001) return 'Transaction Reverted or RPC Error';
  if (effectiveCode === 4001) return 'Transaction Rejected'; // MetaMask user-denied convention
  if (effectiveCode === -32002) return 'Request Already Pending — check your wallet';

  if (err.message) {
    const msg = err.message.replace(/\(action=.*\)/, '').trim();
    if (msg.includes('rate limit') || msg.includes('rate-limited') || msg.includes('too many requests') || msg.includes('429'))
      return 'RPC Rate Limited — Retrying with alternate node...';
    if (msg.includes('insufficient liquidity') || msg.includes('4a1ebbb2')) return 'InsufficientLiquidity()';
    if (msg.includes('PRICE_IMPACT') || msg.includes('price impact')) return 'Price Impact Too High';
    if (msg.includes('timeout') || code === 'TIMEOUT') return 'Timeout';
    if (msg.includes('could not detect network') || code === 'NETWORK_ERROR') return 'RPC Unavailable';
    if (msg.includes('user rejected') || msg.includes('denied')) return 'Transaction Rejected';
    if (msg.includes('insufficient funds')) return 'Insufficient Funds for Gas';
    if (msg.includes('nonce')) return 'Nonce Error — please retry';
    if (msg.includes('13c9b4a8')) return 'Expired()';
    if (msg.includes('4e6ecda7')) return 'InvalidPath()';
    if (msg.includes('c85d0ccd')) return 'InvalidPool()';
    if (msg.includes('97a96f05')) return 'ZeroAddress()';
    if (msg.includes('1f15a6e5')) return 'ZeroAmount()';
    if (msg.includes('69c83c3b')) return 'OnlyWrappedNative()';
    if (msg.includes('d01a83a0')) return 'CircuitBreakerActive()';
    if (msg.includes('71c4efed')) return 'SlippageExceeded()';
    // Fallback: truncate raw messages so they never overflow the error card,
    // even with the break-words/max-h fix already applied to the UI.
    return msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
  }
  return 'Unknown error';
}

function toWeiAmount(amount: string, decimals: number): string {
  // Parse as decimal string to avoid scientific notation
  const [intPart, fracPart = ''] = amount.split('.');
  const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const combined = (intPart + padded).replace(/^0+/, '') || '0';
  return combined;
}

const DEFAULT_BACKEND_URL = 'https://orvixbackend.vercel.app';

export function useQuote() {
  const { settings } = useSettings();
  const [pools, setPools] = useState<PoolAssessment[]>([]);
  const [selectedPool, setSelectedPool] = useState<PoolAssessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectingPool, setSelectingPool] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPools = useCallback(
    async (tokenIn: TokenInfo, tokenOut: TokenInfo, amountIn: string, userAddress: string) => {
      if (!amountIn || parseFloat(amountIn) <= 0) {
        setPools([]);
        setSelectedPool(null);
        setError(null);
        return;
      }

      if (!userAddress) {
        setError('Wallet not connected');
        return;
      }

      // Reset previous results when token/amount changes
      setPools([]);
      setSelectedPool(null);
      setLoading(true);
      setError(null);

      try {
        const decimalsIn = tokenIn.decimals;
        const amountInWei = toWeiAmount(amountIn, decimalsIn);

        const backendUrl = settings.backendUrl || DEFAULT_BACKEND_URL;
        const response = await fetch(`${backendUrl}/api/assess-pools`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token_in: tokenIn.address,
            token_out: tokenOut.address,
            amount_in: amountInWei,
            user_address: userAddress,
            rpc_url: settings.rpcUrl, // power-user custom RPC, backend falls back to default if it fails
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to assess pools');
        }

        const data = await response.json();

        const assessedPools: PoolAssessment[] = data.assessments.map((p: any) => ({
          pool: p.pool,
          output: BigInt(p.output),
          liquidity: BigInt(p.liquidity),
          priceImpact: BigInt(p.price_impact_bps),
          score: BigInt(p.score),
          eligible: p.eligible,
          failReason: BigInt(p.fail_reason_code),
          // path/amountOutMin/factory are NOT present yet — only populated
          // once the user clicks this pool, via selectPool() below.
        }));

        setPools(assessedPools);

        // Don't auto-select - user must click to select
        setSelectedPool(null);
      } catch (e) {
        setPools([]);
        setSelectedPool(null);
        setError(isRateLimitError(e) ? 'RPC rate limited. Retrying with alternate node...' : parseBackendError(e));
      } finally {
        setLoading(false);
      }
    },
    [settings.backendUrl, settings.rpcUrl]
  );

  /**
   * Called when the user clicks a pool from the Pool Assessment list.
   *
   * Sets the pool as selected immediately (so the UI feels responsive and
   * highlights the chosen card right away), then fetches the real swap
   * `path` for that SPECIFIC pool from the backend's
   * POST /api/build-path-for-pool endpoint.
   *
   * This deliberately does NOT call quoteExactInput() — Orvix lets the user
   * pick any of the 3 pools shown (not just the best-scored one) as an
   * educational/transparency feature, matching the CLI's
   * "SELECT POOL FOR SWAP" flow. quoteExactInput() always auto-picks the
   * best pool internally, so it can't build a path for a user-chosen
   * non-best pool — the backend instead replicates the contract's own
   * path-encoding logic directly (see Trade-Backend.py encode_path()).
   */
  const selectPool = useCallback(
    async (pool: PoolAssessment, tokenIn: TokenInfo, tokenOut: TokenInfo) => {
      // Show the selection immediately for responsive UX
      setSelectedPool(pool);
      setError(null);

      if (!pool.eligible) {
        // Ineligible pools (failReason != 0) can't be swapped — no point
        // fetching a path for them.
        return;
      }

      setSelectingPool(true);
      try {
        const backendUrl = settings.backendUrl || DEFAULT_BACKEND_URL;
        const response = await fetch(`${backendUrl}/api/build-path-for-pool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token_in: tokenIn.address,
            token_out: tokenOut.address,
            pool_address: pool.pool,
            pool_output: pool.output.toString(),
            slippage_bps: settings.slippageBps,
            rpc_url: settings.rpcUrl,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to build path for selected pool');
        }

        const data = await response.json();

        // Merge path/amountOutMin/factory info into the selected pool.
        // Functional update so this stays correct even if the user rapidly
        // clicks a different pool while this fetch is still in flight.
        setSelectedPool((current) => {
          if (!current || current.pool !== pool.pool) return current;
          return {
            ...current,
            path: data.path,
            amountOutMin: BigInt(data.amount_out_min),
            factory: data.factory,
            feeNumerator: data.fee_numerator,
            feeDenominator: data.fee_denominator,
          };
        });
      } catch (e) {
        setError(isRateLimitError(e) ? 'RPC rate limited. Retrying with alternate node...' : parseBackendError(e));
      } finally {
        setSelectingPool(false);
      }
    },
    [settings.backendUrl, settings.slippageBps, settings.rpcUrl]
  );

  const resetPools = useCallback(() => {
    setPools([]);
    setSelectedPool(null);
    setError(null);
  }, []);

  return {
    pools,
    selectedPool,
    loading,
    selectingPool, // true while fetching path for a just-clicked pool
    error,
    fetchPools,
    selectPool,
    resetPools,
  };
}

export function useTokenBalance() {
  const { settings } = useSettings();

  const getBalance = useCallback(
    async (token: TokenInfo, walletAddress: string): Promise<string> => {
      try {
        return await withRpcRetry(async (provider) => {
          if (token.isNative) {
            const bal = await provider.getBalance(walletAddress);
            return formatUnits(bal, 18);
          }
          const contract = new Contract(token.address, ERC20_ABI, provider);
          const bal = await contract.balanceOf(walletAddress);
          return formatUnits(bal, token.decimals);
        }, settings.rpcUrl);
      } catch {
        return '0';
      }
    },
    [settings]
  );

  return { getBalance };
}

export function useAllowance() {
  const { settings } = useSettings();

  const getAllowance = useCallback(
    async (token: TokenInfo, walletAddress: string): Promise<bigint> => {
      if (token.isNative) return BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      try {
        return await withRpcRetry(async (provider) => {
          const contract = new Contract(token.address, ERC20_ABI, provider);
          console.log('[Orvix useAllowance] contract target:', token.address);
          console.log('[Orvix useAllowance] owner:', walletAddress);
          console.log('[Orvix useAllowance] spender (ORVIX_AGGREGATOR):', ADDRESSES.ORVIX_AGGREGATOR);
          console.log('[Orvix useAllowance] rpc used:', settings.rpcUrl);
          const result = await contract.allowance(walletAddress, ADDRESSES.ORVIX_AGGREGATOR);
          console.log('[Orvix useAllowance] result:', result.toString());
          return result;
        }, settings.rpcUrl);
      } catch (e) {
        // Previously this silently returned 0n on ANY error, which made a
        // failed/unreadable allowance look identical to a genuine zero
        // allowance — hiding exactly the kind of BAD_DATA / RPC issue we're
        // debugging. Log it so it's visible in the console instead of
        // disappearing.
        console.log('[Orvix useAllowance] FAILED, returning 0n as fallback. Error:', e);
        return 0n;
      }
    },
    [settings]
  );

  return { getAllowance };
}

export { parseBackendError };

