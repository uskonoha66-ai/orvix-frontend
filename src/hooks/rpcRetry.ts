import { JsonRpcProvider } from 'ethers';
import { FALLBACK_RPCS } from '../constants/contracts';

const RATE_LIMIT_ERRORS = [
  'rate limit',
  'rate-limited',
  'too many requests',
  '429',
  '-32005',
  // NOTE: '-32603' was removed from this list — it is the generic JSON-RPC
  // "Internal Error" code, NOT specific to rate limiting. Treating it as a
  // rate-limit error caused unrelated failures (e.g. BAD_DATA / decode
  // errors surfaced as -32603 in ethers' wrapped error message) to be
  // misclassified, which in turn made withRpcRetry() skip the RPC-rotation
  // fallback entirely for those cases and throw immediately instead.
];

// Errors where ethers failed to decode the eth_call response (commonly
// value="0x", code=BAD_DATA). In practice this is frequently caused by a
// flaky/unsynced RPC endpoint returning an empty response rather than a
// genuine contract/ABI mismatch — so it's worth retrying against a
// different RPC from FALLBACK_RPCS before giving up, same as a rate limit.
const RETRYABLE_DECODE_ERRORS = [
  'could not decode result data',
  'bad_data',
  'value="0x"',
];

export function isRateLimitError(error: unknown): boolean {
  const msg = String((error as { message?: string; code?: string | number })?.message ?? error).toLowerCase();
  return RATE_LIMIT_ERRORS.some((s) => msg.includes(s));
}

// Separate from isRateLimitError on purpose: callers that specifically want
// to distinguish "we got rate limited" (for UI messaging) from "the RPC gave
// us garbage, try another one" (for retry logic) can use this directly.
export function isRetryableRpcError(error: unknown): boolean {
  const msg = String((error as { message?: string; code?: string | number })?.message ?? error).toLowerCase();
  return (
    RATE_LIMIT_ERRORS.some((s) => msg.includes(s)) ||
    RETRYABLE_DECODE_ERRORS.some((s) => msg.includes(s))
  );
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
      console.log(`[Orvix withRpcRetry] attempt ${attempt + 1} failed on ${rpc}:`, e);
      // FIX: was isRateLimitError(e) — now also retries on BAD_DATA/decode
      // failures, which is exactly the error class hit in the wallet-B
      // approve() bug (value="0x", code=BAD_DATA) that previously caused
      // this to throw immediately without ever trying FALLBACK_RPCS.
      if (isRetryableRpcError(e) && attempt < FALLBACK_RPCS.length - 1) {
        rpc = getNextRpc();
        console.log(`[Orvix withRpcRetry] retrying with next RPC:`, rpc);
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

