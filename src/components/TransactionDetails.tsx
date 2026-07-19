import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Clock, Fuel, Route, Percent, Activity, Link as LinkIcon, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { TxInfo, PoolAssessment } from '../types';
import { BLOCK_EXPLORER } from '../constants/contracts';

interface TransactionDetailsProps {
  selectedPool: PoolAssessment | null;
  txInfo: TxInfo | null;
}

function shortAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return 'Native';
  return addr.slice(0, 8) + '...' + addr.slice(-4);
}

export default function TransactionDetails({ selectedPool, txInfo }: TransactionDetailsProps) {
  const [expanded, setExpanded] = useState(false);

  const hasPath = !!selectedPool?.path;
  const hasContent = hasPath || txInfo;

  return (
    <div className="px-5 md:px-0 md:max-w-[480px] mx-auto w-full">
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasContent}
        className="w-full flex items-center justify-between p-3 rounded-xl border border-border bg-white/[0.02] hover:bg-hover transition-colors disabled:opacity-40"
      >
        <span className="text-xs font-medium text-text-secondary">Transaction Details</span>
        <ChevronDown size={14} className={`text-text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-2.5">
              <Row
                icon={<Percent size={14} />}
                label="Liquidity Provider Fee"
                value={
                  selectedPool?.feeNumerator !== undefined && selectedPool?.feeDenominator
                    ? `${(100 - (selectedPool.feeNumerator / selectedPool.feeDenominator) * 100).toFixed(2)}%`
                    : '0.25%'
                }
              />
              <Row icon={<Activity size={14} />} label="Swap Fee" value="0.05%" />
              <Row icon={<Route size={14} />} label="Execution Path" value="Direct" />
              <Row icon={<Clock size={14} />} label="Est. Confirmation Time" value="~3 sec" />
              <Row icon={<Fuel size={14} />} label="Gas Used" value={hasPath ? '~180,000 gas' : '—'} />

              {selectedPool && (
                <Row icon={<Route size={14} />} label="Pool" value={shortAddr(selectedPool.pool)} />
              )}
              {selectedPool?.factory && (
                <Row icon={<Route size={14} />} label="Factory" value={shortAddr(selectedPool.factory)} />
              )}

              {txInfo && (
                <div className="pt-2 mt-2 border-t border-border">
                  <div className="flex items-center gap-2 mb-2">
                    {txInfo.status === 'pending' && <Loader2 size={14} className="text-accent-cyan animate-spin" />}
                    {txInfo.status === 'confirmed' && <CheckCircle size={14} className="text-success" />}
                    {txInfo.status === 'failed' && <XCircle size={14} className="text-error" />}
                    <span className="text-xs font-medium capitalize text-text-primary">{txInfo.type} — {txInfo.status}</span>
                  </div>
                  <a
                    href={`${BLOCK_EXPLORER}/tx/${txInfo.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-accent-cyan hover:underline"
                  >
                    <LinkIcon size={12} />
                    <span className="font-mono">{txInfo.hash.slice(0, 18)}...{txInfo.hash.slice(-6)}</span>
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-text-muted">{icon}</span>
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <span className="text-xs font-medium text-text-primary">{value}</span>
    </div>
  );
}

