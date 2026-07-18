import { useState, useCallback } from 'react';
import { Contract, formatUnits } from 'ethers';
import { withRpcRetry, isRateLimitError } from './rpcRetry';
import { useSettings } from '../contexts/SettingsContext';
import { ADDRESSES, ORVIX_ABI, ERC20_ABI } from '../constants/contracts';
import type { TokenInfo, QuoteResult, PoolAssessment } from '../types';

function parseBackendError(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const err = e as { reason?: string; message?: string; data?: { message?: string }; code?: string | number };
  if (err.reason) return err.reason;
  if (err.data?.message) return err.data.message;
  const code = err.code;
  if (err.message) {
    const msg = err.message.replace(/\(action=.*\)/, '').trim();
    if (msg.includes('insufficient liquidity') || msg.includes('4a1ebbb2')) return 'InsufficientLiquidity()';
    if (msg.includes('PRICE_IMPACT') || msg.includes('price impact')) return 'Price Impact Too High';
    if (msg.includes('timeout') || code === 'TIMEOUT') return 'Timeout';
    if (msg.includes('could not detect network') || code === 'NETWORK_ERROR') return 'RPC Unavailable';
    if (msg.includes('user rejected') || msg.includes('denied')) return 'Transaction Rejected';
    if (msg.includes('13c9b4a8')) return 'Expired()';
    if (msg.includes('4e6ecda7')) return 'InvalidPath()';
    if (msg.includes('c85d0ccd')) return 'InvalidPool()';
    if (msg.includes('97a96f05')) return 'ZeroAddress()';
    if (msg.includes('1f15a6e5')) return 'ZeroAmount()';
    if (msg.includes('69c83c3b')) return 'OnlyWrappedNative()';
    if (msg.includes('d01a83a0')) return 'CircuitBreakerActive()';
    if (msg.includes('71c4efed')) return 'SlippageExceeded()';
    return msg;
  }
  return 'Unknown error';
}

function toWeiAmount(amount: string, decimals: number): bigint {
  // Parse as decimal string to avoid scientific notation from BigInt
  const [intPart, fracPart = ''] = amount.split('.');
  const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const combined = (intPart + padded).replace(/^0+/, '') || '0';
  return BigInt(combined);
}

export function useQuote() {
  const { settings } = useSettings();
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [pools, setPools] = useState<PoolAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = useCallback(
    async (tokenIn: TokenInfo, tokenOut: TokenInfo, amountIn: string) => {
      if (!amountIn || parseFloat(amountIn) <= 0) {
        setQuote(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const decimalsIn = tokenIn.decimals;
        const amountInWei = toWeiAmount(amountIn, decimalsIn);

        const result = await withRpcRetry(async (provider) => {
          const contract = new Contract(ADDRESSES.ORVIX_AGGREGATOR, ORVIX_ABI, provider);
          return contract.quoteExactInput(
            tokenIn.address,
            tokenOut.address,
            amountInWei,
            [], // factories — empty = auto
            BigInt(settings.slippageBps)
          );
        }, settings.rpcUrl);

        const r = result;
        setQuote({
          hops: r.hops,
          amountOut: r.amountOut,
          priceImpact: r.priceImpact,
          amountOutMin: r.amountOutMin,
          path: r.path,
          liquidityProfile: r.liquidityProfile,
          poolLiquidity: r.poolLiquidity,
          bestPool: r.bestPool,
        });
      } catch (e) {
        setQuote(null);
        setError(isRateLimitError(e) ? 'RPC rate limited. Retrying with alternate node...' : parseBackendError(e));
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );

  const fetchPools = useCallback(
    async (tokenIn: TokenInfo, tokenOut: TokenInfo, amountIn: string) => {
      if (!amountIn || parseFloat(amountIn) <= 0) return;

      try {
        const decimalsIn = tokenIn.decimals;
        const amountInWei = toWeiAmount(amountIn, decimalsIn);

        const result = await withRpcRetry(async (provider) => {
          const contract = new Contract(ADDRESSES.ORVIX_AGGREGATOR, ORVIX_ABI, provider);
          return contract.assessPools(
            tokenIn.address,
            tokenOut.address,
            amountInWei,
            [], // factories
            false // rawMode = false
          );
        }, settings.rpcUrl);

        setPools(
          result.map((p: { pool: string; output: bigint; liquidity: bigint; priceImpact: bigint; score: bigint; eligible: boolean; failReason: bigint }) => ({
            pool: p.pool,
            output: p.output,
            liquidity: p.liquidity,
            priceImpact: p.priceImpact,
            score: p.score,
            eligible: p.eligible,
            failReason: p.failReason,
          }))
        );
      } catch {
        setPools([]);
      }
    },
    [settings]
  );

  return { quote, pools, loading, error, fetchQuote, fetchPools };
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
          return await contract.allowance(walletAddress, ADDRESSES.ORVIX_AGGREGATOR);
        }, settings.rpcUrl);
      } catch {
        return 0n;
      }
    },
    [settings]
  );

  return { getAllowance };
}

export { parseBackendError };
