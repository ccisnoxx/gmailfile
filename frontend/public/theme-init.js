(function () {
  try {
    var mode = 'system';
    var raw = window.localStorage.getItem('gm_display_settings');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (
        parsed &&
        (parsed.themeMode === 'light' ||
          parsed.themeMode === 'dark' ||
          parsed.themeMode === 'system')
      ) {
        mode = parsed.themeMode;
      }
    }
    var prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved =
      mode === 'dark' || (mode === 'system' && prefersDark) ? 'dark' : 'light';
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.colorScheme = resolved;
  } catch (_) {
    // 隐私模式禁用存储时静默回退默认浅色/系统样式。
  }
})();
