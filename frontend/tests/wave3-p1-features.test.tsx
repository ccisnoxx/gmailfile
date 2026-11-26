import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISPLAY_SETTINGS_STORAGE_KEY,
  readDisplaySettings,
} from '@/components/macos';
import { AppearanceCard } from '@/features/settings/appearance-card';
import { applyThemeMode, resolveTheme } from '@/lib/theme';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-mode');
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

describe('Wave 3 P1 深色模式与 PWA 安全边界验证', () => {
  it('支持浅色/深色/跟随系统三态切换，并持久化与同步至 HTML 主题属性', async () => {
    const onAlpha = vi.fn();
    render(<AppearanceCard navAlpha={60} onNavAlphaChange={onAlpha} />);

    await userEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(readDisplaySettings().themeMode).toBe('dark');
    expect(window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY)).toContain(
      '"themeMode":"dark"',
    );

    await userEvent.click(screen.getByRole('button', { name: '浅色' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // 跟随系统随 prefers-color-scheme 解析
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    expect(resolveTheme('system')).toBe('dark');
    expect(applyThemeMode('system')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('PWA manifest、图标与手写 sw.js 严格满足同源与绝不缓存 /api/* 安全红线', () => {
    const publicDir = path.resolve(process.cwd(), 'public');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf-8'),
    ) as {
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string }[];
    };
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      expect(
        fs.existsSync(path.join(publicDir, icon.src.replace(/^\//, ''))),
      ).toBe(true);
    }

    const swSource = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf-8');
    expect(swSource).toContain("url.pathname.startsWith('/api/')");
    expect(swSource).toContain("request.method !== 'GET'");
    expect(swSource).toContain("request.mode === 'navigate'");
    expect(swSource).toContain('Cache-Control');
    expect(swSource).toContain('no-store');
    expect(swSource).toContain('CLEAR_CACHES');

    // 验证 index.html 使用外部同源 theme-init.js，不含内联脚本（遵守严格 CSP）
    const indexHtml = fs.readFileSync(
      path.resolve(process.cwd(), 'index.html'),
      'utf-8',
    );
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toContain('<script src="/theme-init.js"></script>');
    expect(fs.existsSync(path.join(publicDir, 'theme-init.js'))).toBe(true);
  });
});
