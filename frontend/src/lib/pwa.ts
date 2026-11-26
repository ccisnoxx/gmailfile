import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    Boolean(nav.standalone) ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}

export function setupPwaRuntime(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyListeners();
  });

  if (
    !('serviceWorker' in navigator) ||
    !window.isSecureContext ||
    import.meta.env.MODE === 'test'
  ) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        /* 非 HTTPS 本机或隐私浏览器可能禁用 SW，保持静默降级。 */
      });
  });
}

export function clearServiceWorkerCaches(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHES' });
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(() => Boolean(deferredPrompt));
  const [installed, setInstalled] = useState(() => isStandalonePwa());

  useEffect(() => {
    const sync = () => {
      setCanInstall(Boolean(deferredPrompt));
      setInstalled(isStandalonePwa());
    };
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    if (!deferredPrompt) return 'unavailable';
    const current = deferredPrompt;
    deferredPrompt = null;
    notifyListeners();
    await current.prompt();
    const choice = await current.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
    }
    return choice.outcome;
  }, []);

  return { canInstall, installed, promptInstall };
}
