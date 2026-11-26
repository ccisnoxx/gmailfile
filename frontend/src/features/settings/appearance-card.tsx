import { useId, useState } from 'react';
import {
  AlignJustify,
  CheckCircle2,
  Download,
  Layers,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  Waves,
} from 'lucide-react';
import {
  MacSwitch,
  NavigationOpacitySlider,
  persistDisplaySettings,
  readDisplaySettings,
  type DisplaySettingsState,
} from '@/components/macos';
import { usePwaInstall } from '@/lib/pwa';
import { resolveTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { SettingsCardShell } from './settings-card-shell';

const THEME_OPTIONS: readonly {
  value: ThemeMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

export function AppearanceCard({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  showDisplayToggles = false,
}: {
  navAlpha: number;
  onNavAlphaChange: (next: number) => void;
  displaySettings?: DisplaySettingsState;
  onDisplaySettingsChange?: (next: DisplaySettingsState) => void;
  showDisplayToggles?: boolean;
}) {
  const bgId = useId();
  const animId = useId();
  const compactId = useId();
  const [fallbackSettings, setFallbackSettings] =
    useState<DisplaySettingsState>(() => readDisplaySettings());
  const activeSettings = displaySettings ?? fallbackSettings;
  const updateSettings = (next: DisplaySettingsState) => {
    if (onDisplaySettingsChange) {
      onDisplaySettingsChange(next);
    } else {
      setFallbackSettings(next);
      persistDisplaySettings(next);
    }
  };
  const resolvedDark = resolveTheme(activeSettings.themeMode) === 'dark';
  const pwa = usePwaInstall();
  const [pwaNotice, setPwaNotice] = useState('');

  return (
    <SettingsCardShell
      id="settings-card-appearance"
      title="界面与体验"
      subtitle="深色/浅色/跟随系统主题、共享毛玻璃透明度与桌面 PWA 安装，仅保存非敏感外观偏好"
      icon={<Layers className="size-4" />}
    >
      {/* 外观主题选择（浅色 / 深色 / 跟随系统） */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--table-divider)] pb-3.5">
        <div>
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            外观主题
          </p>
          <p className="text-[12px] text-[var(--text-secondary)]">
            自适应 macOS 毛玻璃表面并满足 WCAG 2.2 AA 对比度
          </p>
        </div>
        <div
          role="group"
          aria-label="外观主题"
          className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-0.5"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = activeSettings.themeMode === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  updateSettings({ ...activeSettings, themeMode: value })
                }
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12px] font-medium transition-colors',
                  active
                    ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_168px]">
        {/* 左侧：共享透明度滑块 */}
        <div className="space-y-2.5">
          <NavigationOpacitySlider
            variant="card"
            value={navAlpha}
            onChange={onNavAlphaChange}
          />
          <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
            拖动即时预览侧栏与顶栏亚克力通透度，自动同步并持久化至本地浏览器偏好。
          </p>
        </div>

        {/* 右侧：小型玻璃效果实时预览块 */}
        <div
          role="img"
          data-slot="glass-opacity-preview"
          aria-label={`毛玻璃效果预览 ${navAlpha}%`}
          className="relative h-[96px] overflow-hidden rounded-2xl border border-[var(--border)] p-2.5 shadow-[0_8px_22px_rgba(45,86,138,0.09)]"
          style={{
            background: resolvedDark
              ? 'linear-gradient(135deg, #0b1628 0%, #152b4f 52%, #1d3c6e 100%)'
              : 'linear-gradient(135deg, #d7ecff 0%, #9ec8ff 52%, #7bb2ff 100%)',
          }}
        >
          {/* 背景装饰光斑，用于清晰呈现透明度变化 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-4 -right-3 size-14 rounded-full bg-white/40 blur-md"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-3 left-2 size-12 rounded-full bg-[#1677ff]/35 blur-md"
          />

          {/* 实时响应 navAlpha 与深浅色的迷你玻璃导航预览 */}
          <div
            data-slot="glass-opacity-preview-surface"
            className="relative flex h-full flex-col justify-between rounded-xl border border-[var(--border)] p-2 transition-colors duration-[180ms]"
            style={{
              backgroundColor: resolvedDark
                ? `rgba(18, 28, 46, ${navAlpha / 100})`
                : `rgba(248, 252, 255, ${navAlpha / 100})`,
              backdropFilter: 'blur(18px) saturate(145%)',
              WebkitBackdropFilter: 'blur(18px) saturate(145%)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-[#ff5f57]" />
                <span className="size-1.5 rounded-full bg-[#febc2e]" />
                <span className="size-1.5 rounded-full bg-[#28c840]" />
              </div>
              <span className="text-[10px] font-semibold tabular-nums text-[var(--accent)]">
                {navAlpha}%
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="h-2 w-3/4 rounded-full bg-[var(--accent)]/30" />
              <div className="h-1.5 w-1/2 rounded-full bg-[var(--text-secondary)]/30" />
            </div>
            <p className="text-[10px] font-medium text-[var(--text-secondary)]">
              实时毛玻璃预览
            </p>
          </div>
        </div>
      </div>

      {/* PWA 桌面应用安装状态与安全说明 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--table-divider)] pt-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            PWA 桌面安装
          </p>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Service Worker 仅缓存公开静态界面壳，绝不缓存 /api/*
            或任何凭据响应。
          </p>
          {pwaNotice && (
            <p
              role="status"
              className="mt-1 text-[11.5px] text-[var(--accent)]"
            >
              {pwaNotice}
            </p>
          )}
        </div>
        {pwa.installed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2.5 py-1 text-xs font-medium text-[var(--success-text)]">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            已作为桌面应用运行
          </span>
        ) : pwa.canInstall ? (
          <button
            type="button"
            onClick={async () => {
              const outcome = await pwa.promptInstall();
              setPwaNotice(
                outcome === 'accepted'
                  ? '已提交桌面应用安装。'
                  : '已取消本次安装，可随时再次安装。',
              );
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-xs font-medium text-[var(--primary-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span>安装到桌面</span>
          </button>
        ) : (
          <span className="text-[11.5px] text-[var(--text-secondary)]">
            可在浏览器地址栏或 Safari“添加到程序坞”安装
          </span>
        )}
      </div>

      {/* 可选扩展显示开关（在“界面与体验”分类下或开启时展示） */}
      {showDisplayToggles && (
        <div className="space-y-3 border-t border-[var(--table-divider)] pt-3.5">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={bgId}
              className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]"
            >
              <Waves
                className="size-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>使用流动桌面背景</span>
            </label>
            <MacSwitch
              id={bgId}
              checked={activeSettings.flowingBackground}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...activeSettings,
                  flowingBackground: checked,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={animId}
              className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]"
            >
              <Sparkles
                className="size-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>界面过渡动画</span>
            </label>
            <MacSwitch
              id={animId}
              checked={activeSettings.animationsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...activeSettings,
                  animationsEnabled: checked,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={compactId}
              className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]"
            >
              <AlignJustify
                className="size-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>紧凑密度模式</span>
            </label>
            <MacSwitch
              id={compactId}
              checked={activeSettings.compactMode}
              onCheckedChange={(checked) =>
                updateSettings({
                  ...activeSettings,
                  compactMode: checked,
                })
              }
            />
          </div>
        </div>
      )}
    </SettingsCardShell>
  );
}
