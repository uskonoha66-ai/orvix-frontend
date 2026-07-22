import { useCallback } from 'react';
import { Contract } from 'ethers';
import { ERC20_ABI } from '../constants/contracts';
import type { TokenInfo } from '../types';
import { useSettings } from '../contexts/SettingsContext';
import { withRpcRetry } from './rpcRetry';

export function useTokenMetadata() {
  const { settings } = useSettings();

  const fetchMetadata = useCallback(
    async (address: string): Promise<TokenInfo | null> => {
      try {
        // FIX: was a single JsonRpcProvider(settings.rpcUrl) with no retry —
        // if that one RPC returned BAD_DATA/empty response (the same class
        // of error hit in the approve() bug), this silently failed and
        // returned null, which looks identical to "not a valid token" in
        // the UI (e.g. Token Selector's "Paste Contract Address" flow).
        // withRpcRetry automatically rotates through FALLBACK_RPCS on
        // retryable errors instead of giving up on the first bad response.
        return await withRpcRetry(async (provider) => {
          const contract = new Contract(address, ERC20_ABI, provider);
          console.log('[Orvix fetchMetadata] contract target:', address);
          const [symbol, name, decimals] = await Promise.all([
            contract.symbol(),
            contract.name(),
            contract.decimals(),
          ]);
          console.log('[Orvix fetchMetadata] result:', { symbol, name, decimals: Number(decimals) });
          return { address, symbol, name, decimals: Number(decimals) };
        }, settings.rpcUrl);
      } catch (e) {
        // Distinguish "genuinely not a token contract" from "RPC couldn't
        // read it" in the console, since both currently return null to the
        // caller — this at least makes the difference visible when
        // debugging instead of disappearing entirely.
        console.log('[Orvix fetchMetadata] FAILED for address', address, '— error:', e);
        return null;
      }
    },
    [settings]
  );

  return { fetchMetadata };
}

