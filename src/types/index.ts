export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  isNative?: boolean;
  verified?: boolean;
}

export interface HopInfo {
  pool: string;
  tokenOut: string;
  v2FeeNumerator: number;
  v2FeeDenominator: number;
  factory: string;
}

export interface QuoteResult {
  hops: HopInfo[];
  amountOut: bigint;
  priceImpact: bigint;
  amountOutMin: bigint;
  path: string; // bytes — hex string
  liquidityProfile: string;
  poolLiquidity: bigint;
  bestPool: string;
}

export interface PoolAssessment {
  pool: string;
  output: bigint;
  liquidity: bigint;
  priceImpact: bigint;
  score: bigint;
  eligible: boolean;
  failReason: bigint;
}

export interface SwapSettings {
  rpcUrl: string;
  slippageBps: number;
  deadlineMinutes: number;
  maxImpactBps: number;
  treasury: string;
  integrator: string;
}

export type SwapStatus =
  | 'idle'
  | 'approving'
  | 'approved'
  | 'swapping'
  | 'pending'
  | 'confirmed'
  | 'failed';

export interface TxInfo {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed';
  type: 'approve' | 'swap' | 'wrap' | 'unwrap';
}

export type WalletType =
  | 'metamask'
  | 'walletconnect'
  | 'trust'
  | 'binance'
  | 'coinbase'
  | 'rabby';

export interface WalletState {
  address: string | null;
  chainId: number | null;
  connected: boolean;
  walletType: WalletType | null;
}

export type Theme = 'dark' | 'light' | 'system';

export type SwapMode = 'swap' | 'wrap' | 'unwrap';

export interface BackendError {
  message: string;
  code?: string | number;
  data?: unknown;
}

// failReason bitmask flags from assessPools
export const FAIL_REASON_FLAGS = [
  { bit: 1, label: 'ZERO_RESERVE' },
  { bit: 2, label: 'ZERO_OUTPUT' },
  { bit: 4, label: 'ZERO_LIQUIDITY' },
  { bit: 8, label: 'PRICE_IMPACT' },
  { bit: 16, label: 'CIRCUIT_BREAKER' },
];

export function decodeFailReason(mask: bigint): string {
  if (mask === 0n) return 'None';
  const reasons: string[] = [];
  for (const f of FAIL_REASON_FLAGS) {
    if ((mask & BigInt(f.bit)) !== 0n) reasons.push(f.label);
  }
  return reasons.length ? reasons.join(' | ') : 'None';
}
