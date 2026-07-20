import type { TokenInfo } from '../types';

// Contract addresses — BSC Testnet
export const CHAIN_ID = 97;
export const NETWORK_NAME = 'BSC Testnet';
export const DEFAULT_RPC = 'https://bsc-testnet-rpc.publicnode.com';
export const FALLBACK_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://bsc-testnet.drpc.org',
  'https://data-seed-prebsc-1-s1.binance.org:8545/',
  'https://data-seed-prebsc-2-s1.binance.org:8545/',
  'https://data-seed-prebsc-1-s2.binance.org:8545/',
  'https://data-seed-prebsc-2-s2.binance.org:8545/',
  'https://data-seed-prebsc-1-s3.binance.org:8545/',
  'https://data-seed-prebsc-2-s3.binance.org:8545/',
];
export const BLOCK_EXPLORER = 'https://testnet.bscscan.com';

export const ADDRESSES = {
  ORVIX_AGGREGATOR: '0xA4Bf191D53B880cA49F1ceD0C0C840378bdDef42',
  WBNB: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
  NATIVE: '0x0000000000000000000000000000000000000000',
  TREASURY: '0x0000000000000000000000000000000000000000',
  INTEGRATOR: '0x0000000000000000000000000000000000000000',
};

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const WBNB_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// ABI matches assespool.py ORVIX_ABI exactly
export const ORVIX_ABI = [
  `function quoteExactInput(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    address[] factories,
    uint256 slippageBps
  ) view returns (
    tuple(
      tuple(
        address pool,
        address tokenOut,
        uint16 v2FeeNumerator,
        uint16 v2FeeDenominator,
        address factory
      )[] hops,
      uint256 amountOut,
      uint256 priceImpact,
      uint256 amountOutMin,
      bytes path,
      string liquidityProfile,
      uint256 poolLiquidity,
      address bestPool
    ) result
  )`,
  `function swapExactInput(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOutMin,
    address recipient,
    uint256 deadline,
    bytes path,
    address treasury,
    address integrator
  ) payable returns (uint256 amountOut)`,
  `function assessPools(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    address[] factories,
    bool rawMode
  ) view returns (
    tuple(
      address pool,
      uint256 output,
      uint256 liquidity,
      uint256 priceImpact,
      uint256 score,
      bool eligible,
      uint256 failReason
    )[] assessments
  )`,
];

export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const DEFAULT_DEADLINE_MINUTES = 20;
export const MAX_PRICE_IMPACT_BPS = 100000; // 1000% — matches backend MAX_PRICE_IMPACT
export const QUOTE_REFRESH_MS = 15000;

export const VERIFIED_TOKENS: TokenInfo[] = [
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    isNative: true,
    verified: true,
  },
  {
    address: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    verified: true,
  },
  {
    address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
    symbol: 'USDT',
    name: 'Tether USDT Token',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    verified: true,
  },
  {
    address: '0x0b826aFC12380Cd138ED9e7211631033fa51716F',
    symbol: 'USST',
    name: 'USST Token',
    decimals: 18,
    verified: true,
  },
  {
    address: '0xE844E1201df67D3c4aAA5656b2296a775C9F844A',
    symbol: 'TRAV',
    name: 'TRAV Token',
    decimals: 9,
    verified: true,
  },
  {
    address: '0xF504A700fe1eC44A565cd4b5a2f6c6f536b5FB98',
    symbol: 'BTS',
    name: 'BTS Token',
    decimals: 18,
    verified: true,
  },
];
