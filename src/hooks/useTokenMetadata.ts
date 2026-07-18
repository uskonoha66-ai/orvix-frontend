import { useCallback } from 'react';
import { JsonRpcProvider, Contract } from 'ethers';
import { ERC20_ABI } from '../constants/contracts';
import type { TokenInfo } from '../types';
import { useSettings } from '../contexts/SettingsContext';

export function useTokenMetadata() {
  const { settings } = useSettings();

  const fetchMetadata = useCallback(
    async (address: string): Promise<TokenInfo | null> => {
      try {
        const provider = new JsonRpcProvider(settings.rpcUrl);
        const contract = new Contract(address, ERC20_ABI, provider);
        const [symbol, name, decimals] = await Promise.all([
          contract.symbol(),
          contract.name(),
          contract.decimals(),
        ]);
        return { address, symbol, name, decimals: Number(decimals) };
      } catch {
        return null;
      }
    },
    [settings]
  );

  return { fetchMetadata };
}
