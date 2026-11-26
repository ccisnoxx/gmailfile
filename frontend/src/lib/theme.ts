export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function getSystemPrefersDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return getSystemPrefersDark() ? 'dark' : 'light';
}

export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const themeChanged =
      Boolean(root.dataset.theme) && root.dataset.theme !== resolved;
    if (themeChanged) {
      root.classList.add('theme-switching');
    }
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    if (themeChanged) {
      // 强制同步样式计算后在下一帧恢复过渡，确保深浅色原子切换无半浅半深闪烁
      void root.offsetWidth;
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(() => {
          root.classList.remove('theme-switching');
        });
      } else {
        root.classList.remove('theme-switching');
      }
    }
  }
  return resolved;
}

export function subscribeSystemTheme(
  onChange: (isDark: boolean) => void,
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => {};
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }
  return () => {};
}
