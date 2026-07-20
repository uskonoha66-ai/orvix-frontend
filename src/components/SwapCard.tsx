import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDownUp, Loader2, Settings2, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { TokenInfo, SwapMode, PoolAssessment } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useQuote, useTokenBalance, useAllowance } from '../hooks/useQuote';
import { useSwapExecution } from '../hooks/useSwapExecution';
import { VERIFIED_TOKENS, ADDRESSES } from '../constants/contracts';
import TokenModal from './TokenModal';
import QuoteDetails from './QuoteDetails';
import TransactionDetails from './TransactionDetails';

const BNB_TOKEN = VERIFIED_TOKENS[0];
const WBNB_TOKEN = VERIFIED_TOKENS[1];

/**
 * Shrinks the amount input's font size as the number of visible characters
 * grows, so long numbers (e.g. wallet-max BNB balances like
 * "15.01831395917728") never get covered by the token selector button.
 * Mirrors the pattern used by Uniswap and similar swap UIs.
 */
function inputFontSize(value: string): string {
  const len = value.length;
  if (len <= 8) return 'text-2xl';
  if (len <= 12) return 'text-xl';
  if (len <= 16) return 'text-lg';
  return 'text-base';
}

export default function SwapCard() {
  const { address, connected, provider, connect } = useWallet();
  const { settings } = useSettings();
  const { toast } = useToast();

  const [tokenIn, setTokenIn] = useState<TokenInfo>(VERIFIED_TOKENS[0]);
  const [tokenOut, setTokenOut] = useState<TokenInfo>(VERIFIED_TOKENS[2]);
  const [amountIn, setAmountIn] = useState('');
  const [tokenModalOpen, setTokenModalOpen] = useState<false | 'in' | 'out'>(false);
  const [recentTokens, setRecentTokens] = useState<TokenInfo[]>([]);
  const [balanceIn, setBalanceIn] = useState<string | null>(null);
  const [balanceOut, setBalanceOut] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [showSlippage, setShowSlippage] = useState(false);

  const {
    pools,
    selectedPool,
    loading: poolsLoading,
    selectingPool,
    error: poolsError,
    fetchPools,
    selectPool,
    resetPools,
  } = useQuote();
  const { getBalance } = useTokenBalance();
  const { getAllowance } = useAllowance();
  const { status, txInfo, error: swapError, approve, swap, wrapBNB, unwrapWBNB, reset } = useSwapExecution();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect wrap/unwrap mode
  const isWrapMode = tokenIn.isNative && tokenOut.address === ADDRESSES.WBNB;
  const isUnwrapMode = tokenIn.address === ADDRESSES.WBNB && tokenOut.isNative;
  const swapMode: SwapMode = isWrapMode ? 'wrap' : isUnwrapMode ? 'unwrap' : 'swap';

  // Load recent tokens from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('orvix_recent_tokens');
      if (saved) setRecentTokens(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const addRecent = useCallback((t: TokenInfo) => {
    setRecentTokens((prev) => {
      const filtered = prev.filter((p) => p.address !== t.address);
      const next = [t, ...filtered].slice(0, 6);
      localStorage.setItem('orvix_recent_tokens', JSON.stringify(next));
      return next;
    });
  }, []);

  // Fetch balances
  useEffect(() => {
    if (!connected || !address) {
      setBalanceIn(null);
      setBalanceOut(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [b1, b2] = await Promise.all([
        getBalance(tokenIn, address),
        getBalance(tokenOut, address),
      ]);
      if (!cancelled) {
        setBalanceIn(b1);
        setBalanceOut(b2);
      }
    })();
    return () => { cancelled = true; };
  }, [tokenIn, tokenOut, address, connected, getBalance]);

  // Fetch pool assessments with debounce (replaces the old fetchQuote polling —
  // no auto-refresh interval anymore, since the user picks a pool manually and
  // we don't want the selection to reset itself mid-decision)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (swapMode !== 'swap') {
      resetPools();
      return;
    }
    if (!amountIn || parseFloat(amountIn) <= 0 || !address) {
      resetPools();
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetchPools(tokenIn, tokenOut, amountIn, address);
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, tokenIn, tokenOut, swapMode, address]);

  // Check allowance when a pool has been selected (i.e. we have a real path
  // and are about to need approval)
  useEffect(() => {
    if (!connected || !address || !amountIn || tokenIn.isNative || swapMode !== 'swap') {
      setAllowance(0n);
      return;
    }
    let cancelled = false;
    (async () => {
      const allow = await getAllowance(tokenIn, address);
      if (!cancelled) {
        setAllowance(allow);
      }
    })();
    return () => { cancelled = true; };
  }, [tokenIn, address, connected, amountIn, getAllowance, swapMode]);

  // Toast on tx status changes
  useEffect(() => {
    if (!txInfo) return;
    if (txInfo.status === 'confirmed') {
      toast({
        type: 'success',
        title: `${txInfo.type.charAt(0).toUpperCase() + txInfo.type.slice(1)} Confirmed`,
        txHash: txInfo.hash,
      });
    } else if (txInfo.status === 'failed') {
      toast({
        type: 'error',
        title: `${txInfo.type.charAt(0).toUpperCase() + txInfo.type.slice(1)} Failed`,
        description: swapError || undefined,
        txHash: txInfo.hash,
      });
    }
  }, [txInfo, toast, swapError]);

  const handleSwitch = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn('');
    resetPools();
    reset();
  };

  const handleSelectToken = (t: TokenInfo) => {
    if (tokenModalOpen === 'in') {
      if (t.address === tokenOut.address) setTokenOut(tokenIn);
      setTokenIn(t);
    } else {
      if (t.address === tokenIn.address) setTokenIn(tokenOut);
      setTokenOut(t);
    }
    setAmountIn('');
    resetPools();
    reset();
  };

  const handleMax = () => {
    if (balanceIn) setAmountIn(parseFloat(balanceIn).toString());
  };

  const handlePoolSelect = (pool: PoolAssessment) => {
    selectPool(pool, tokenIn, tokenOut);
  };

  const amountInWeiApprox = amountIn ? BigInt(Math.floor(parseFloat(amountIn) * 10 ** tokenIn.decimals)) : 0n;
  const needsApproval =
    swapMode === 'swap' && !tokenIn.isNative && !!selectedPool?.path && allowance < amountInWeiApprox;

  const insufficientBalance = balanceIn !== null && amountIn !== '' && parseFloat(amountIn) > parseFloat(balanceIn);

  const priceImpactHigh = !!selectedPool && Number(selectedPool.priceImpact) > settings.maxImpactBps;

  const handleApprove = async () => {
    if (!provider) return;
    const ok = await approve(tokenIn, amountIn, provider);
    if (ok) {
      setAllowance(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));
      toast({ type: 'success', title: 'Approval Confirmed' });
    }
  };

  const handleSwap = async () => {
    if (!provider || !selectedPool || !selectedPool.path) return;
    if (priceImpactHigh) {
      toast({ type: 'warning', title: 'Price Impact Too High', description: 'Consider reducing the amount' });
      return;
    }
    const hash = await swap(tokenIn, tokenOut, amountIn, selectedPool, provider);
    if (hash) {
      setAmountIn('');
      resetPools();
      // Refresh balances
      if (address) {
        const [b1, b2] = await Promise.all([
          getBalance(tokenIn, address),
          getBalance(tokenOut, address),
        ]);
        setBalanceIn(b1);
        setBalanceOut(b2);
      }
    }
  };

  const handleWrapUnwrap = async () => {
    if (!provider) return;
    if (swapMode === 'wrap') {
      const hash = await wrapBNB(amountIn, provider);
      if (hash && address) {
        const [b1, b2] = await Promise.all([
          getBalance(BNB_TOKEN, address),
          getBalance(WBNB_TOKEN, address),
        ]);
        setBalanceIn(b1);
        setBalanceOut(b2);
      }
    } else if (swapMode === 'unwrap') {
      const hash = await unwrapWBNB(amountIn, provider);
      if (hash && address) {
        const [b1, b2] = await Promise.all([
          getBalance(WBNB_TOKEN, address),
          getBalance(BNB_TOKEN, address),
        ]);
        setBalanceIn(b1);
        setBalanceOut(b2);
      }
    }
  };

  const getButtonConfig = () => {
    if (!connected) return { label: 'Connect Wallet', action: () => connect('metamask'), disabled: false, variant: 'primary' };
    if (!amountIn || parseFloat(amountIn) <= 0) return { label: 'Enter Amount', action: () => {}, disabled: true, variant: 'default' };
    if (insufficientBalance) return { label: 'Insufficient Balance', action: () => {}, disabled: true, variant: 'error' };
    if (poolsError) return { label: poolsError, action: () => {}, disabled: true, variant: 'error' };

    if (swapMode === 'wrap') {
      if (status === 'wrapping') return { label: 'Wrapping...', action: () => {}, disabled: true, variant: 'loading' };
      return { label: 'Wrap BNB', action: handleWrapUnwrap, disabled: false, variant: 'primary' };
    }
    if (swapMode === 'unwrap') {
      if (status === 'unwrapping') return { label: 'Unwrapping...', action: () => {}, disabled: true, variant: 'loading' };
      return { label: 'Unwrap WBNB', action: handleWrapUnwrap, disabled: false, variant: 'primary' };
    }

    // swap mode from here on
    if (!selectedPool) return { label: 'Select a Pool', action: () => {}, disabled: true, variant: 'default' };
    if (selectingPool) return { label: 'Fetching Path...', action: () => {}, disabled: true, variant: 'loading' };
    if (!selectedPool.eligible) return { label: 'Pool Not Eligible', action: () => {}, disabled: true, variant: 'error' };
    if (priceImpactHigh) return { label: 'Price Impact Too High', action: () => {}, disabled: true, variant: 'warning' };
    if (!selectedPool.path) return { label: 'Building Path...', action: () => {}, disabled: true, variant: 'loading' };

    if (needsApproval) {
      if (status === 'approving') return { label: 'Approving...', action: () => {}, disabled: true, variant: 'loading' };
      return { label: 'Approve', action: handleApprove, disabled: false, variant: 'primary' };
    }

    if (status === 'swapping') return { label: 'Swapping...', action: () => {}, disabled: true, variant: 'loading' };
    return { label: 'Swap', action: handleSwap, disabled: false, variant: 'primary' };
  };

  const btn = getButtonConfig();

  const buttonClass = {
    primary: 'bg-accent-cyan text-bg-primary hover:brightness-110',
    default: 'bg-white/[0.04] text-text-muted cursor-not-allowed',
    error: 'bg-error/10 text-error border border-error/20 cursor-not-allowed',
    warning: 'bg-warning/10 text-warning border border-warning/20 cursor-not-allowed',
    loading: 'bg-white/[0.04] text-accent-cyan cursor-wait',
  }[btn.variant];

  return (
    <div className="relative z-10 px-5 md:px-0 md:max-w-[480px] mx-auto w-full">
      {/* From */}
      <div className="p-5 rounded-3xl border border-border bg-white/[0.03]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-text-secondary">From</span>
          <div className="flex items-center gap-2">
            {balanceIn !== null && connected && (
              <span className="text-xs text-text-muted">Balance: {parseFloat(balanceIn).toFixed(4)}</span>
            )}
            {connected && (
              <button
                onClick={handleMax}
                className="text-xs font-medium text-accent-cyan hover:brightness-125 transition-all"
              >
                MAX
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="0.0"
            className={`flex-1 bg-transparent font-semibold focus:outline-none placeholder:text-text-muted min-w-0 truncate ${inputFontSize(amountIn)}`}
          />
          <TokenSelectButton token={tokenIn} onClick={() => setTokenModalOpen('in')} />
        </div>
      </div>

      {/* Center switch */}
      <div className="flex justify-center -my-3 relative z-20">
        <motion.button
          onClick={handleSwitch}
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.05 }}
          className="w-10 h-10 rounded-full border border-border bg-bg-secondary hover:border-accent-cyan/30 hover:bg-hover flex items-center justify-center transition-colors duration-200"
        >
          <ArrowDownUp size={16} className="text-accent-cyan" />
        </motion.button>
      </div>

      {/* To */}
      <div className="p-5 rounded-3xl border border-border bg-white/[0.03]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-text-secondary">Receive</span>
          {balanceOut !== null && connected && (
            <span className="text-xs text-text-muted">Balance: {parseFloat(balanceOut).toFixed(4)}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div
            className={`flex-1 font-semibold text-text-secondary min-w-0 truncate ${inputFontSize(
              swapMode === 'swap' && selectedPool
                ? (Number(selectedPool.output) / 10 ** tokenOut.decimals).toString()
                : ''
            )}`}
          >
            {swapMode === 'swap' && selectedPool && !poolsLoading
              ? parseFloat(
                  (Number(selectedPool.output) / 10 ** tokenOut.decimals).toString()
                ).toLocaleString(undefined, { maximumFractionDigits: 6 })
              : swapMode === 'swap' && poolsLoading
              ? <span className="text-text-muted">...</span>
              : <span className="text-text-muted">0.0</span>
            }
          </div>
          <TokenSelectButton token={tokenOut} onClick={() => setTokenModalOpen('out')} />
        </div>
      </div>

      {/* Mode badge */}
      {(isWrapMode || isUnwrapMode) && (
        <div className="mt-3 flex justify-center">
          <span className="px-3 py-1 rounded-full bg-accent-navy/30 border border-accent-cyan/20 text-accent-cyan text-xs font-medium">
            {isWrapMode ? 'Wrap BNB → WBNB' : 'Unwrap WBNB → BNB'}
          </span>
        </div>
      )}

      {/* Pool assessment + quote details */}
      {swapMode === 'swap' && (
        <div className="mt-5">
          <QuoteDetails
            pools={pools}
            selectedPool={selectedPool}
            loading={poolsLoading}
            selectingPool={selectingPool}
            error={poolsError}
            tokenIn={tokenIn}
            tokenOut={tokenOut}
            onSelectPool={handlePoolSelect}
          />
        </div>
      )}

      {/* Transaction details */}
      <div className="mt-3">
        <TransactionDetails selectedPool={selectedPool} txInfo={txInfo} />
      </div>

      {/* Slippage quick config */}
      <div className="mt-3">
        <button
          onClick={() => setShowSlippage(!showSlippage)}
          className="w-full flex items-center justify-between p-3 rounded-xl border border-border bg-white/[0.02] hover:bg-hover transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={14} className="text-text-muted" />
            <span className="text-xs text-text-secondary">Slippage Tolerance</span>
          </div>
          <span className="text-xs font-medium text-text-primary">{(settings.slippageBps / 100).toFixed(1)}%</span>
        </button>
        <AnimatePresence>
          {showSlippage && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-3 flex gap-2">
                {[10, 50, 100, 300].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => settings.slippageBps !== bps && setShowSlippage(false)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                      settings.slippageBps === bps
                        ? 'bg-accent-cyan text-bg-primary'
                        : 'bg-white/[0.03] text-text-secondary hover:bg-hover'
                    }`}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Swap button */}
      <div className="mt-4">
        <motion.button
          onClick={btn.action}
          disabled={btn.disabled}
          whileTap={{ scale: btn.disabled ? 1 : 0.98 }}
          className={`w-full py-4 rounded-2xl font-semibold text-sm transition-all duration-200 ${buttonClass}`}
        >
          <span className="flex items-center justify-center gap-2">
            {btn.variant === 'loading' && <Loader2 size={16} className="animate-spin" />}
            {btn.label}
          </span>
        </motion.button>
      </div>

      {/* Error display — swap/approve/wrap execution errors. Pool assessment
          errors already surface through the button label above. */}
      <AnimatePresence>
        {swapError && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex items-start gap-2 p-3 rounded-xl border border-error/20 bg-error/5"
          >
            <AlertTriangle size={14} className="text-error shrink-0 mt-0.5" />
            <p className="text-xs text-error leading-relaxed break-words max-w-full min-w-0 max-h-[120px] overflow-y-auto">{swapError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tx status indicator */}
      {txInfo && (
        <div className="mt-3 flex items-center gap-2 p-3 rounded-xl border border-border bg-white/[0.02]">
          {txInfo.status === 'pending' && <Loader2 size={14} className="text-accent-cyan animate-spin" />}
          {txInfo.status === 'confirmed' && <CheckCircle size={14} className="text-success" />}
          {txInfo.status === 'failed' && <XCircle size={14} className="text-error" />}
          <span className="text-xs text-text-secondary capitalize">
            {txInfo.type} {txInfo.status}
          </span>
          <a
            href={`https://testnet.bscscan.com/tx/${txInfo.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-accent-cyan hover:underline font-mono"
          >
            {txInfo.hash.slice(0, 10)}...{txInfo.hash.slice(-4)}
          </a>
        </div>
      )}

      <TokenModal
        open={tokenModalOpen !== false}
        onClose={() => setTokenModalOpen(false)}
        onSelect={handleSelectToken}
        excludeAddress={tokenModalOpen === 'in' ? tokenOut.address : tokenIn.address}
        recentTokens={recentTokens}
        onAddRecent={addRecent}
      />
    </div>
  );
}

function TokenSelectButton({ token, onClick }: { token: TokenInfo; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-border hover:border-border-hover hover:bg-hover transition-all duration-200 shrink-0"
    >
      <div className="w-6 h-6 rounded-full bg-accent-navy/40 flex items-center justify-center overflow-hidden">
        {token.logoURI ? (
          <img src={token.logoURI} alt={token.symbol} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold">{token.symbol.slice(0, 2)}</span>
        )}
      </div>
      <span className="text-sm font-medium">{token.symbol}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-text-muted">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

