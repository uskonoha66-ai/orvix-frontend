import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, AlertTriangle, TrendingDown, Route, Droplets, ArrowDownToLine, Layers } from 'lucide-react';
import { formatUnits } from 'ethers';
import type { QuoteResult, PoolAssessment, TokenInfo } from '../types';
import { decodeFailReason } from '../types';
import { QuoteSkeleton } from './ui/Skeleton';

interface QuoteDetailsProps {
  quote: QuoteResult | null;
  pools: PoolAssessment[];
  loading: boolean;
  error: string | null;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
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

function LiquidityLabel(profile: string): { label: string; color: string } {
  const p = profile.toLowerCase();
  if (p.includes('high')) return { label: profile, color: 'text-success' };
  if (p.includes('medium') || p.includes('moderate')) return { label: profile, color: 'text-warning' };
  if (p.includes('low') || p.includes('poor')) return { label: profile, color: 'text-error' };
  return { label: profile || 'Unknown', color: 'text-text-secondary' };
}

export default function QuoteDetails({ quote, pools, loading, error, tokenIn, tokenOut }: QuoteDetailsProps) {
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

        {quote && !loading && !error && (
          <motion.div
            key="quote"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2.5"
          >
            <Row icon={<ArrowDownToLine size={14} />} label="Expected Output" value={`${formatToken(quote.amountOut, tokenOut.decimals)} ${tokenOut.symbol}`} />
            <Row icon={<TrendingDown size={14} />} label="Minimum Received" value={`${formatToken(quote.amountOutMin, tokenOut.decimals)} ${tokenOut.symbol}`} />
            <Row
              icon={<Route size={14} />}
              label="Execution Route"
              value={quote.hops.length > 1 ? `${quote.hops.length} hops` : 'Direct'}
            />
            <Row
              icon={<Droplets size={14} />}
              label="Liquidity Source"
              value={shortAddr(quote.bestPool)}
              valueClass={LiquidityLabel(quote.liquidityProfile).color}
            />
            <Row
              icon={<TrendingDown size={14} />}
              label="Price Impact"
              value={formatBps(quote.priceImpact)}
              valueClass={Number(quote.priceImpact) > 50000 ? 'text-error' : Number(quote.priceImpact) > 10000 ? 'text-warning' : 'text-text-secondary'}
            />
            <Row icon={<Layers size={14} />} label="Pool Liquidity" value={`${formatToken(quote.poolLiquidity, tokenIn.decimals)} ${tokenIn.symbol}`} />

            {/* Hops detail */}
            {quote.hops.length > 0 && (
              <div className="pt-1">
                <p className="text-xs text-text-muted mb-1.5">Route Hops</p>
                <div className="space-y-1">
                  {quote.hops.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="text-text-secondary">{shortAddr(h.pool)}</span>
                      <span className="text-text-muted">→ {shortAddr(h.tokenOut)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {!loading && !error && !quote && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-2"
          >
            <p className="text-xs text-text-muted">Enter an amount to get a quote</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pool assessment */}
      {pools.length > 0 && <PoolAssessmentList pools={pools} tokenOut={tokenOut} />}
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

function PoolAssessmentList({ pools, tokenOut }: { pools: PoolAssessment[]; tokenOut: TokenInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-hover transition-colors"
      >
        <span className="text-xs font-medium text-text-secondary">Pool Assessment ({pools.length})</span>
        <ChevronDown size={14} className={`text-text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0 space-y-2">
              {pools.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${p.eligible ? 'bg-success' : 'bg-error'}`} />
                    <span className="text-[11px] text-text-secondary">{shortAddr(p.pool)}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-text-primary">{formatToken(p.output, tokenOut.decimals)}</p>
                    <p className="text-[10px] text-text-muted">
                      {p.eligible ? `Score ${Number(p.score)}` : decodeFailReason(p.failReason)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
