import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletProvider } from './contexts/WalletContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { ToastProvider } from './contexts/ToastContext';
import Background from './components/ui/Background';
import Header from './components/Header';
import SwapCard from './components/SwapCard';
import SettingsPage from './components/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30000, refetchOnWindowFocus: false },
  },
});

type Page = 'home' | 'settings';

function AppContent() {
  const [page, setPage] = useState<Page>('home');

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <Background />
      <div className="relative z-10 flex flex-col min-h-screen">
        <Header onNavigate={setPage} />
        <main className="flex-1 py-8 md:py-12">
          {page === 'home' ? <SwapCard /> : <SettingsPage onBack={() => setPage('home')} />}
        </main>
        <footer className="px-5 md:px-8 py-6 text-center">
          <p className="text-xs text-text-muted">Orvix Labs — Decentralized Exchange</p>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <WalletProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </WalletProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
