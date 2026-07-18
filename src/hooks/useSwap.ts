import { useState, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import type { Signer } from 'ethers';
import { ADDRESSES, ORVIX_ABI, ERC20_ABI, WBNB_ABI } from '../constants/contracts';
import type { TokenInfo, TxInfo, QuoteResult } from '../types';
import { parseBackendError } from './useQuote';
import { useSettings } from '../contexts/SettingsContext';

export function useSwapExecution() {
  const { settings } = useSettings();
  const [status, setStatus] = useState<'idle' | 'approving' | 'swapping' | 'wrapping' | 'unwrapping'>('idle');
  const [txInfo, setTxInfo] = useState<TxInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getSigner = useCallback(async (provider: BrowserProvider): Promise<Signer> => {
    return provider.getSigner();
  }, []);

  const approve = useCallback(
    async (
      token: TokenInfo,
      _amountIn: string,
      provider: BrowserProvider
    ): Promise<boolean> => {
      setError(null);
      setStatus('approving');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(token.address, ERC20_ABI, signer);
        // Approve max — matches backend ensure_approved
        const MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const tx = await contract.approve(ADDRESSES.ORVIX_AGGREGATOR, MAX);
        setTxInfo({ hash: tx.hash, status: 'pending', type: 'approve' });
        await tx.wait();
        setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'approve' });
        setStatus('idle');
        return true;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return false;
      }
    },
    [getSigner]
  );

  const swap = useCallback(
    async (
      tokenIn: TokenInfo,
      tokenOut: TokenInfo,
      amountIn: string,
      quote: QuoteResult,
      provider: BrowserProvider
    ): Promise<string | null> => {
      setError(null);
      setStatus('swapping');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(ADDRESSES.ORVIX_AGGREGATOR, ORVIX_ABI, signer);

        // Backend uses deadline = 9999999999 (effectively no expiry)
        const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMinutes * 60);
        const amountInWei = parseUnits(amountIn, tokenIn.decimals);

        // swapExactInput(tokenIn, tokenOut, amountIn, amountOutMin, recipient, deadline, path, treasury, integrator)
        const txOpts: { value?: bigint } = tokenIn.isNative ? { value: amountInWei } : {};

        const tx = await contract.swapExactInput(
          tokenIn.address,
          tokenOut.address,
          amountInWei,
          quote.amountOutMin,
          await signer.getAddress(),
          deadline,
          quote.path, // bytes from the quote
          settings.treasury,
          settings.integrator,
          txOpts
        );

        setTxInfo({ hash: tx.hash, status: 'pending', type: 'swap' });
        const receipt = await tx.wait();

        if (receipt?.status === 1) {
          setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'swap' });
        } else {
          setTxInfo({ hash: tx.hash, status: 'failed', type: 'swap' });
          setError('Transaction Failed');
        }

        setStatus('idle');
        return tx.hash;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return null;
      }
    },
    [getSigner, settings]
  );

  const wrapBNB = useCallback(
    async (amount: string, provider: BrowserProvider): Promise<string | null> => {
      setError(null);
      setStatus('wrapping');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(ADDRESSES.WBNB, WBNB_ABI, signer);
        const amountWei = parseUnits(amount, 18);
        const tx = await contract.deposit({ value: amountWei });
        setTxInfo({ hash: tx.hash, status: 'pending', type: 'wrap' });
        await tx.wait();
        setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'wrap' });
        setStatus('idle');
        return tx.hash;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return null;
      }
    },
    [getSigner]
  );

  const unwrapWBNB = useCallback(
    async (amount: string, provider: BrowserProvider): Promise<string | null> => {
      setError(null);
      setStatus('unwrapping');
      try {
        const signer = await getSigner(provider);
        const contract = new Contract(ADDRESSES.WBNB, WBNB_ABI, signer);
        const amountWei = parseUnits(amount, 18);
        const tx = await contract.withdraw(amountWei);
        setTxInfo({ hash: tx.hash, status: 'pending', type: 'unwrap' });
        await tx.wait();
        setTxInfo({ hash: tx.hash, status: 'confirmed', type: 'unwrap' });
        setStatus('idle');
        return tx.hash;
      } catch (e) {
        setError(parseBackendError(e));
        setTxInfo((t) => (t ? { ...t, status: 'failed' } : null));
        setStatus('idle');
        return null;
      }
    },
    [getSigner]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setTxInfo(null);
    setError(null);
  }, []);

  return { status, txInfo, error, approve, swap, wrapBNB, unwrapWBNB, reset };
}
