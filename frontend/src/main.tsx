import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import {
  readDisplaySettings,
  subscribeDisplaySettings,
} from '@/components/macos';
import { setupPwaRuntime } from '@/lib/pwa';
import { applyThemeMode, subscribeSystemTheme } from '@/lib/theme';
import { Providers } from './app/providers';
import { router } from './app/router';
import './styles/globals.css';

applyThemeMode(readDisplaySettings().themeMode);
subscribeDisplaySettings((next) => applyThemeMode(next.themeMode));
subscribeSystemTheme(() => {
  const current = readDisplaySettings();
  if (current.themeMode === 'system') {
    applyThemeMode('system');
  }
});
setupPwaRuntime();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
