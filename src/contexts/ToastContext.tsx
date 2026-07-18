import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  txHash?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-success" />,
  error: <XCircle size={16} className="text-error" />,
  warning: <AlertTriangle size={16} className="text-warning" />,
  info: <Info size={16} className="text-accent-cyan" />,
};

const BORDER_COLORS: Record<ToastType, string> = {
  success: 'border-success/30',
  error: 'border-error/30',
  warning: 'border-warning/30',
  info: 'border-accent-cyan/20',
};

function ToastItem({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 48, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.94 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`relative flex items-start gap-3 p-4 rounded-2xl border bg-bg-secondary shadow-soft min-w-[280px] max-w-[360px] ${BORDER_COLORS[t.type]}`}
    >
      <div className="mt-0.5 shrink-0">{ICONS[t.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{t.title}</p>
        {t.description && (
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{t.description}</p>
        )}
        {t.txHash && (
          <a
            href={`https://testnet.bscscan.com/tx/${t.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-cyan hover:underline mt-1 block"
          >
            View on Explorer
          </a>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = String(++counterRef.current);
    const duration = opts.duration ?? (opts.type === 'error' ? 6000 : 4000);
    setToasts((ts) => [...ts, { ...opts, id }]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 items-end">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <ToastItem key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
