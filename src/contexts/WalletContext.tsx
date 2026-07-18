import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { BrowserProvider } from 'ethers';
import type { WalletState, WalletType } from '../types';


interface WalletContextValue extends WalletState {
  connect: (type: WalletType) => Promise<void>;
  disconnect: () => void;
  provider: BrowserProvider | null;
  error: string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4).toUpperCase();
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    connected: false,
    walletType: null,
  });
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getEthereumProvider = useCallback((type: WalletType): unknown => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as Record<string, unknown>;

    if (type === 'binance' && w.BinanceChain) return w.BinanceChain;
    if (type === 'coinbase' && (w as { ethereum?: { isCoinbaseWallet?: boolean; providers?: unknown[] } }).ethereum?.isCoinbaseWallet) {
      return w.ethereum;
    }
    const eth = w.ethereum as
      | undefined
      | { providers?: { isMetaMask?: boolean; isRabby?: boolean; isTrust?: boolean }[]; isMetaMask?: boolean; isRabby?: boolean; isTrust?: boolean };

    if (eth?.providers) {
      if (type === 'metamask') return eth.providers.find((p) => p.isMetaMask && !p.isRabby);
      if (type === 'rabby') return eth.providers.find((p) => p.isRabby);
      if (type === 'trust') return eth.providers.find((p) => p.isTrust);
    }
    return eth ?? null;
  }, []);

  const connect = useCallback(async (type: WalletType) => {
    setError(null);
    try {
      let rawProvider = getEthereumProvider(type);
      if (!rawProvider) throw new Error(`${type} wallet not detected.`);

      const ethProvider = new BrowserProvider(rawProvider as never);
      const accounts: string[] = await ethProvider.send('eth_requestAccounts', []);
      if (!accounts.length) throw new Error('No accounts returned.');

      const network = await ethProvider.getNetwork();
      setProvider(ethProvider);
      setState({
        address: accounts[0],
        chainId: Number(network.chainId),
        connected: true,
        walletType: type,
      });

      // Listen for account/chain changes
      const rp = rawProvider as { on?: (event: string, cb: (...args: unknown[]) => void) => void };
      rp.on?.('accountsChanged', (accs: unknown) => {
        const accounts = accs as string[];
        if (!accounts.length) {
          setState({ address: null, chainId: null, connected: false, walletType: null });
          setProvider(null);
        } else {
          setState((s) => ({ ...s, address: accounts[0] }));
        }
      });
      rp.on?.('chainChanged', () => window.location.reload());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [getEthereumProvider]);

  const disconnect = useCallback(() => {
    setState({ address: null, chainId: null, connected: false, walletType: null });
    setProvider(null);
    setError(null);
  }, []);

  // Auto-reconnect if previously connected
  useEffect(() => {
    const saved = localStorage.getItem('orvix_wallet_type') as WalletType | null;
    if (!saved) return;
    const w = window as unknown as Record<string, unknown>;
    if (w.ethereum) connect(saved).catch(() => {});
  }, [connect]);

  // Persist wallet type
  useEffect(() => {
    if (state.walletType) localStorage.setItem('orvix_wallet_type', state.walletType);
    else localStorage.removeItem('orvix_wallet_type');
  }, [state.walletType]);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, provider, error }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}

export { shortenAddress };
