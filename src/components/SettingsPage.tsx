import { useState } from 'react';
import { ArrowLeft, Save, RotateCcw, Check } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { DEFAULT_RPC, CHAIN_ID, NETWORK_NAME } from '../constants/contracts';
import type { Theme } from '../types';

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SystemIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

export default function SettingsPage({ onBack }: { onBack: () => void }) {
  const { settings, updateSettings, resetRpc, theme, setTheme } = useSettings();
  const [rpcInput, setRpcInput] = useState(settings.rpcUrl);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateSettings({ rpcUrl: rpcInput });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    resetRpc();
    setRpcInput(DEFAULT_RPC);
  };

  return (
    <div className="relative z-10 px-5 md:px-0 md:max-w-[480px] mx-auto w-full pt-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      <h1 className="text-2xl font-semibold mb-8">Settings</h1>

      {/* RPC Configuration */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">RPC Configuration</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-2">RPC URL</label>
            <input
              type="text"
              value={rpcInput}
              onChange={(e) => setRpcInput(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-border focus:border-accent-cyan/40 focus:outline-none text-sm transition-colors"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-2">Current RPC</label>
            <div className="px-4 py-3 rounded-xl bg-white/[0.02] border border-border text-sm text-text-secondary break-all">
              {settings.rpcUrl}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-cyan text-bg-primary text-sm font-medium hover:brightness-110 transition-all duration-200"
            >
              {saved ? <Check size={16} /> : <Save size={16} />}
              {saved ? 'Saved' : 'Save'}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-border text-sm font-medium hover:bg-hover transition-all duration-200"
            >
              <RotateCcw size={16} />
              Reset Default
            </button>
          </div>
        </div>
      </section>

      {/* Network Info */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Network</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-border">
            <span className="text-sm text-text-secondary">Current Chain ID</span>
            <span className="text-sm font-medium font-mono">{CHAIN_ID}</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-border">
            <span className="text-sm text-text-secondary">Current Network</span>
            <span className="text-sm font-medium">{NETWORK_NAME}</span>
          </div>
        </div>
      </section>

      {/* Theme */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Theme</h2>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'dark' as Theme, label: 'Dark', icon: <MoonIcon /> },
            { value: 'light' as Theme, label: 'Light', icon: <SunIcon /> },
            { value: 'system' as Theme, label: 'System', icon: <SystemIcon /> },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 ${
                theme === opt.value
                  ? 'border-accent-cyan/40 bg-accent-cyan/5 text-accent-cyan'
                  : 'border-border bg-white/[0.02] text-text-secondary hover:bg-hover'
              }`}
            >
              {opt.icon}
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Slippage */}
      <section>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Swap Settings</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-2">Slippage Tolerance</label>
            <div className="flex gap-2">
              {[10, 50, 100, 300].map((bps) => (
                <button
                  key={bps}
                  onClick={() => updateSettings({ slippageBps: bps })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    settings.slippageBps === bps
                      ? 'bg-accent-cyan text-bg-primary'
                      : 'bg-white/[0.03] text-text-secondary hover:bg-hover border border-border'
                  }`}
                >
                  {(bps / 100).toFixed(1)}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-2">Transaction Deadline (minutes)</label>
            <input
              type="number"
              value={settings.deadlineMinutes}
              onChange={(e) => updateSettings({ deadlineMinutes: parseInt(e.target.value) || 20 })}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-border focus:border-accent-cyan/40 focus:outline-none text-sm transition-colors"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
