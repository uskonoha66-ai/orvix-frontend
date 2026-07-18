import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Search, Check, Loader2, AlertCircle } from 'lucide-react';
import { VERIFIED_TOKENS } from '../constants/contracts';
import type { TokenInfo } from '../types';
import { useTokenMetadata } from '../hooks/useTokenMetadata';

interface TokenModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (token: TokenInfo) => void;
  excludeAddress?: string;
  recentTokens: TokenInfo[];
  onAddRecent: (token: TokenInfo) => void;
}

export default function TokenModal({
  open,
  onClose,
  onSelect,
  excludeAddress,
  recentTokens,
  onAddRecent,
}: TokenModalProps) {
  const [search, setSearch] = useState('');
  const [pasteAddress, setPasteAddress] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedToken, setImportedToken] = useState<TokenInfo | null>(null);
  const { fetchMetadata } = useTokenMetadata();

  const filteredVerified = useMemo(() => {
    return VERIFIED_TOKENS.filter(
      (t) =>
        t.address !== excludeAddress &&
        (search === '' ||
          t.symbol.toLowerCase().includes(search.toLowerCase()) ||
          t.name.toLowerCase().includes(search.toLowerCase()))
    );
  }, [search, excludeAddress]);

  const filteredRecent = useMemo(() => {
    return recentTokens.filter(
      (t) =>
        t.address !== excludeAddress &&
        (search === '' ||
          t.symbol.toLowerCase().includes(search.toLowerCase()) ||
          t.name.toLowerCase().includes(search.toLowerCase()))
    );
  }, [recentTokens, search, excludeAddress]);

  const handlePaste = useCallback(async () => {
    if (!pasteAddress || pasteAddress.length < 10) {
      setImportError('Enter a valid contract address');
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportedToken(null);

    const meta = await fetchMetadata(pasteAddress.trim());
    setImporting(false);

    if (!meta) {
      setImportError('Unsupported Token — metadata could not be fetched');
      return;
    }

    setImportedToken(meta);
  }, [pasteAddress, fetchMetadata]);

  const handleSelect = useCallback(
    (token: TokenInfo) => {
      onAddRecent(token);
      onSelect(token);
      setSearch('');
      setPasteAddress('');
      setImportedToken(null);
      setImportError(null);
      onClose();
    },
    [onSelect, onAddRecent, onClose]
  );

  return (
    <AnimatePresence>
      {open && (
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
            className="relative w-full max-w-md p-6 rounded-2xl border border-border bg-bg-secondary shadow-soft max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Select Token</h2>
              <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or symbol"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.03] border border-border focus:border-accent-cyan/40 focus:outline-none text-sm transition-colors"
              />
            </div>

            <div className="overflow-y-auto flex-1 space-y-5 no-scrollbar">
              {/* Verified tokens */}
              <div>
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Verified Tokens</p>
                <div className="space-y-1">
                  {filteredVerified.map((t) => (
                    <TokenRow key={t.address} token={t} onSelect={handleSelect} />
                  ))}
                  {filteredVerified.length === 0 && (
                    <p className="text-xs text-text-muted py-2">No verified tokens match</p>
                  )}
                </div>
              </div>

              {/* Recent tokens */}
              {filteredRecent.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Recent</p>
                  <div className="space-y-1">
                    {filteredRecent.map((t) => (
                      <TokenRow key={t.address} token={t} onSelect={handleSelect} />
                    ))}
                  </div>
                </div>
              )}

              {/* Paste contract */}
              <div>
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Paste Contract Address</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pasteAddress}
                    onChange={(e) => setPasteAddress(e.target.value)}
                    placeholder="0x..."
                    className="flex-1 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border focus:border-accent-cyan/40 focus:outline-none text-sm transition-colors"
                  />
                  <button
                    onClick={handlePaste}
                    disabled={importing}
                    className="px-4 py-2.5 rounded-xl bg-accent-navy hover:brightness-125 disabled:opacity-50 text-sm font-medium transition-all duration-200"
                  >
                    {importing ? <Loader2 size={16} className="animate-spin" /> : 'Detect'}
                  </button>
                </div>

                {importError && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-error">
                    <AlertCircle size={14} />
                    <span>{importError}</span>
                  </div>
                )}

                {importedToken && (
                  <div className="mt-3 p-3 rounded-xl border border-border bg-white/[0.02]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-text-muted">Auto-detected</span>
                      <Check size={14} className="text-success" />
                    </div>
                    <TokenRow token={importedToken} onSelect={handleSelect} />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TokenRow({ token, onSelect }: { token: TokenInfo; onSelect: (t: TokenInfo) => void }) {
  return (
    <button
      onClick={() => onSelect(token)}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-hover transition-colors text-left"
    >
      <div className="w-9 h-9 rounded-full bg-accent-navy/40 flex items-center justify-center overflow-hidden shrink-0">
        {token.logoURI ? (
          <img src={token.logoURI} alt={token.symbol} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-semibold">{token.symbol.slice(0, 2)}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{token.symbol}</span>
          {token.verified && (
            <Check size={12} className="text-accent-cyan shrink-0" />
          )}
        </div>
        <p className="text-xs text-text-secondary truncate">{token.name}</p>
      </div>
      <span className="text-xs text-text-muted">{token.decimals}d</span>
    </button>
  );
}
