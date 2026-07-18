import { JsonRpcProvider } from 'ethers';
import { FALLBACK_RPCS } from '../constants/contracts';

const RATE_LIMIT_ERRORS = [
  'rate limit',
  'rate-limited',
  'too many requests',
  '429',
  '-32005',
  '-32603',
];

export function isRateLimitError(error: unknown): boolean {
  const msg = String((error as { message?: string; code?: string | number })?.message ?? error).toLowerCase();
  return RATE_LIMIT_ERRORS.some((s) => msg.includes(s));
}

let currentRpcIndex = 0;

export function getNextRpc(): string {
  currentRpcIndex = (currentRpcIndex + 1) % FALLBACK_RPCS.length;
  return FALLBACK_RPCS[currentRpcIndex];
}

export function getCurrentRpc(): string {
  return FALLBACK_RPCS[currentRpcIndex];
}

export async function withRpcRetry<T>(
  fn: (provider: JsonRpcProvider, rpcUrl: string) => Promise<T>,
  initialRpc?: string
): Promise<T> {
  let rpc = initialRpc || getCurrentRpc();
  let lastError: unknown;

  for (let attempt = 0; attempt < FALLBACK_RPCS.length; attempt++) {
    const provider = new JsonRpcProvider(rpc);
  provider.pollingInterval = 4000;
    try {
      return await fn(provider, rpc);
    } catch (e) {
      lastError = e;
      if (isRateLimitError(e) && attempt < FALLBACK_RPCS.length - 1) {
        rpc = getNextRpc();
        continue;
      }
      throw e;
    }
  }

  throw lastError;
}

export function createProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl);
}
