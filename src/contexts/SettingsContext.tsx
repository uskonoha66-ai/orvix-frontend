import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { SwapSettings, Theme } from '../types';
import {
  DEFAULT_RPC,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_DEADLINE_MINUTES,
  MAX_PRICE_IMPACT_BPS,
  ADDRESSES,
} from '../constants/contracts';

interface SettingsContextValue {
  settings: SwapSettings;
  theme: Theme;
  updateSettings: (partial: Partial<SwapSettings>) => void;
  resetRpc: () => void;
  setTheme: (t: Theme) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DEFAULT_SETTINGS: SwapSettings = {
  rpcUrl: DEFAULT_RPC,
  slippageBps: DEFAULT_SLIPPAGE_BPS,
  deadlineMinutes: DEFAULT_DEADLINE_MINUTES,
  maxImpactBps: MAX_PRICE_IMPACT_BPS,
  treasury: ADDRESSES.TREASURY,
  integrator: ADDRESSES.INTEGRATOR,
};

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SwapSettings>(() => {
    try {
      const saved = localStorage.getItem('orvix_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('orvix_theme') as Theme) || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('orvix_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('orvix_theme', theme);
    const root = document.documentElement;
    const resolved = theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : theme;
    root.classList.toggle('dark', resolved === 'dark');
  }, [theme]);

  const updateSettings = useCallback((partial: Partial<SwapSettings>) => {
    setSettings((s) => ({ ...s, ...partial }));
  }, []);

  const resetRpc = useCallback(() => {
    setSettings((s) => ({ ...s, rpcUrl: DEFAULT_RPC }));
  }, []);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  return (
    <SettingsContext.Provider value={{ settings, theme, updateSettings, resetRpc, setTheme }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}
