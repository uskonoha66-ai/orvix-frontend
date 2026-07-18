import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, X, Home, Settings as SettingsIcon } from 'lucide-react';
import { useWallet, shortenAddress } from '../contexts/WalletContext';
import type { WalletType } from '../types';

const WALLETS: { type: WalletType; name: string; desc: string }[] = [
  { type: 'metamask', name: 'MetaMask', desc: 'Browser extension' },
  { type: 'walletconnect', name: 'WalletConnect', desc: 'Scan with mobile' },
  { type: 'trust', name: 'Trust Wallet', desc: 'Mobile / extension' },
  { type: 'binance', name: 'Binance Wallet', desc: 'Binance Chain' },
  { type: 'coinbase', name: 'Coinbase Wallet', desc: 'Browser / mobile' },
  { type: 'rabby', name: 'Rabby', desc: 'Browser extension' },
];

function WalletModal({ onClose }: { onClose: () => void }) {
  const { connect } = useWallet();

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[150] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="relative w-full max-w-md p-6 rounded-2xl border border-border bg-bg-secondary shadow-soft"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">Connect Wallet</h2>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="space-y-2">
            {WALLETS.map((w) => (
              <button
                key={w.type}
                onClick={() => { connect(w.type); onClose(); }}
                className="w-full flex items-center justify-between p-4 rounded-xl border border-border hover:border-border-hover hover:bg-hover transition-all duration-200 text-left"
              >
                <div>
                  <p className="font-medium text-sm">{w.name}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{w.desc}</p>
                </div>
                <ChevronDown size={18} className="text-text-muted -rotate-90" />
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function DrawerMenu({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (page: 'home' | 'settings') => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[140] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 right-0 z-[150] h-full w-72 p-6 bg-bg-secondary border-l border-border shadow-soft"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          >
            <div className="flex items-center justify-between mb-8">
              <span className="text-sm font-semibold text-text-secondary">Menu</span>
              <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => { onNavigate('home'); onClose(); }}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-hover transition-colors text-left"
              >
                <Home size={18} className="text-accent-cyan" />
                <span className="text-sm font-medium">Home</span>
              </button>
              <button
                onClick={() => { onNavigate('settings'); onClose(); }}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-hover transition-colors text-left"
              >
                <SettingsIcon size={18} className="text-accent-cyan" />
                <span className="text-sm font-medium">Settings</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default function Header({ onNavigate }: { onNavigate: (page: 'home' | 'settings') => void }) {
  const { address, connected, disconnect, chainId } = useWallet();
  const [showWallet, setShowWallet] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  const isTestnet = chainId !== null && chainId !== 56;

  return (
    <>
      <header className="relative z-10 flex items-center justify-between px-5 md:px-8 py-5">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight">Orvix Labs</span>
        </div>

        <div className="flex items-center gap-3">
          {connected ? (
            <div className="flex items-center gap-2">
              {isTestnet && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full bg-warning/10 border border-warning/20 text-warning text-[11px] font-medium">
                  Testnet
                </span>
              )}
              <button
                onClick={disconnect}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border hover:border-border-hover hover:bg-hover transition-all duration-200"
              >
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-sm font-medium">{shortenAddress(address!)}</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowWallet(true)}
              className="px-5 py-2 rounded-xl bg-accent-cyan text-bg-primary font-medium text-sm hover:brightness-110 active:scale-[0.98] transition-all duration-200"
            >
              Connect Wallet
            </button>
          )}

          {/* Two-line hamburger */}
          <button
            onClick={() => setShowDrawer(true)}
            className="flex flex-col gap-[5px] p-2 rounded-lg hover:bg-hover transition-colors"
            aria-label="Menu"
          >
            <span className="block w-5 h-[2px] bg-text-primary rounded-full" />
            <span className="block w-5 h-[2px] bg-text-primary rounded-full" />
          </button>
        </div>
      </header>

      {showWallet && <WalletModal onClose={() => setShowWallet(false)} />}
      <DrawerMenu open={showDrawer} onClose={() => setShowDrawer(false)} onNavigate={onNavigate} />
    </>
  );
}
