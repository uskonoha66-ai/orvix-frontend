import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, AlertTriangle, TrendingDown, Droplets, ArrowDownToLine, Layers, Loader2 } from 'lucide-react';
import { formatUnits } from 'ethers';
import type { PoolAssessment, TokenInfo } from '../types';
import { decodeFailReason } from '../types';
import { QuoteSkeleton } from './ui/Skeleton';

interface QuoteDetailsProps {
  pools: PoolAssessment[];
  selectedPool: PoolAssessment | null;
  loading: boolean;
  selectingPool: boolean;
  error: string | null;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  onSelectPool: (pool: PoolAssessment) => void;
}

function formatToken(wei: bigint, decimals: number): string {
  if (!wei || wei === 0n) return '0';
  const s = formatUnits(wei, decimals);
  const n = parseFloat(s);
  if (n === 0) return '<0.000001';
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatBps(bps: bigint): string {
  const n = Number(bps) / 100;
  return `${n.toFixed(2)}%`;
}

function shortAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return 'Native';
  return addr.slice(0, 8) + '...' + addr.slice(-4);
}

/**
 * Orvix lets the user pick ANY pool from this list (not just the
 * best-scored one) as an educational/transparency feature — matching the
 * CLI's "SELECT POOL FOR SWAP" flow. Clicking a pool here calls
 * onSelectPool(), which triggers useQuote's selectPool() to fetch the real
 * swap path for that specific pool from POST /api/build-path-for-pool.
 */
export default function QuoteDetails({
  pools,
  selectedPool,
  loading,
  selectingPool,
  error,
  tokenIn,
  tokenOut,
  onSelectPool,
}: QuoteDetailsProps) {
  return (
    <div className="px-5 md:px-0 md:max-w-[480px] mx-auto w-full space-y-3">
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <QuoteSkeleton />
          </motion.div>
        )}

        {error && !loading && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 p-3 rounded-xl border border-error/20 bg-error/5"
          >
            <AlertTriangle size={16} className="text-error shrink-0 mt-0.5" />
            <p className="text-xs text-error leading-relaxed">{error}</p>
          </motion.div>
        )}

        {pools.length > 0 && !loading && !error && (
          <motion.div
            key="pools"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <p className="text-xs text-text-muted px-0.5">Select a pool to swap through</p>
            {pools.map((p, i) => (
              <PoolCard
                key={p.pool}
                pool={p}
                tokenOut={tokenOut}
                isBest={i === 0}
                isSelected={selectedPool?.pool === p.pool}
                isFetchingPath={selectingPool && selectedPool?.pool === p.pool}
                onClick={() => p.eligible && onSelectPool(p)}
              />
            ))}
          </motion.div>
        )}

        {!loading && !error && pools.length === 0 && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-2"
          >
            <p className="text-xs text-text-muted">Enter an amount to see available pools</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected pool's swap details — only shown once path has been fetched */}
      {selectedPool?.path && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2.5 pt-2 border-t border-border"
        >
          <Row
            icon={<ArrowDownToLine size={14} />}
            label="Expected Output"
            value={`${formatToken(selectedPool.output, tokenOut.decimals)} ${tokenOut.symbol}`}
          />
          {selectedPool.amountOutMin !== undefined && (
            <Row
              icon={<TrendingDown size={14} />}
              label="Minimum Received"
              value={`${formatToken(selectedPool.amountOutMin, tokenOut.decimals)} ${tokenOut.symbol}`}
            />
          )}
          <Row icon={<Droplets size={14} />} label="Selected Pool" value={shortAddr(selectedPool.pool)} />
          <Row
            icon={<TrendingDown size={14} />}
            label="Price Impact"
            value={formatBps(selectedPool.priceImpact)}
            valueClass={
              Number(selectedPool.priceImpact) > 5000
                ? 'text-error'
                : Number(selectedPool.priceImpact) > 1000
                ? 'text-warning'
                : 'text-text-secondary'
            }
          />
          <Row
            icon={<Layers size={14} />}
            label="Pool Liquidity"
            value={`${formatToken(selectedPool.liquidity, tokenIn.decimals)} ${tokenIn.symbol}`}
          />
        </motion.div>
      )}
    </div>
  );
}

function Row({ icon, label, value, valueClass = 'text-text-secondary' }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-text-muted">{icon}</span>
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <span className={`text-xs font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

function PoolCard({
  pool,
  tokenOut,
  isBest,
  isSelected,
  isFetchingPath,
  onClick,
}: {
  pool: PoolAssessment;
  tokenOut: TokenInfo;
  isBest: boolean;
  isSelected: boolean;
  isFetchingPath: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!pool.eligible}
      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all duration-200 text-left ${
        isSelected
          ? 'border-accent-cyan/60 bg-accent-cyan/[0.06]'
          : pool.eligible
          ? 'border-border bg-white/[0.02] hover:border-border-hover hover:bg-hover'
          : 'border-border bg-white/[0.01] opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pool.eligible ? 'bg-success' : 'bg-error'}`} />
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-text-secondary">{shortAddr(pool.pool)}</span>
            {isBest && pool.eligible && (
              <span className="px-1.5 py-0.5 rounded-full bg-accent-cyan/15 text-accent-cyan text-[9px] font-semibold">
                BEST
              </span>
            )}
          </div>
          {!pool.eligible && (
            <p className="text-[10px] text-error mt-0.5">{decodeFailReason(pool.failReason)}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="text-[11px] font-medium text-text-primary">{formatToken(pool.output, tokenOut.decimals)}</p>
          <p className="text-[10px] text-text-muted">{pool.eligible ? `Score ${Number(pool.score).toLocaleString()}` : ''}</p>
        </div>
        {isFetchingPath && <Loader2 size={12} className="text-accent-cyan animate-spin shrink-0" />}
      </div>
    </button>
  );
}

