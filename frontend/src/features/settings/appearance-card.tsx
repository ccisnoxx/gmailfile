import { useId } from 'react';
import { AlignJustify, Layers, Sparkles, Waves } from 'lucide-react';
import {
  MacSwitch,
  NavigationOpacitySlider,
  type DisplaySettingsState,
} from '@/components/macos';
import { SettingsCardShell } from './settings-card-shell';

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

  return (
    <SettingsCardShell
      id="settings-card-appearance"
      title="界面与体验"
      subtitle="与账号列表、账号详情共享同一毛玻璃透明度配置，仅保存非敏感外观偏好"
      icon={<Layers className="size-4" />}
    >
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
          className="relative h-[96px] overflow-hidden rounded-2xl border border-white/80 p-2.5 shadow-[0_8px_22px_rgba(45,86,138,0.09)]"
          style={{
            background:
              'linear-gradient(135deg, #d7ecff 0%, #9ec8ff 52%, #7bb2ff 100%)',
          }}
        >
          {/* 背景装饰光斑，用于清晰呈现透明度变化 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-4 -right-3 size-14 rounded-full bg-white/70 blur-md"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-3 left-2 size-12 rounded-full bg-[#1677ff]/35 blur-md"
          />

          {/* 实时响应 navAlpha 的迷你玻璃导航预览 */}
          <div
            data-slot="glass-opacity-preview-surface"
            className="relative flex h-full flex-col justify-between rounded-xl border border-white/75 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-colors duration-[180ms]"
            style={{
              backgroundColor: `rgba(248, 252, 255, ${navAlpha / 100})`,
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
              <div className="h-2 w-3/4 rounded-full bg-[#1677ff]/24" />
              <div className="h-1.5 w-1/2 rounded-full bg-[#667085]/22" />
            </div>
            <p className="text-[10px] font-medium text-[var(--text-secondary)]">
              实时毛玻璃预览
            </p>
          </div>
        </div>
      </div>

      {/* 可选扩展显示开关（在“界面与体验”分类下或开启时展示） */}
      {showDisplayToggles && displaySettings && onDisplaySettingsChange && (
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
              checked={displaySettings.flowingBackground}
              onCheckedChange={(checked) =>
                onDisplaySettingsChange({
                  ...displaySettings,
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
              checked={displaySettings.animationsEnabled}
              onCheckedChange={(checked) =>
                onDisplaySettingsChange({
                  ...displaySettings,
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
              checked={displaySettings.compactMode}
              onCheckedChange={(checked) =>
                onDisplaySettingsChange({
                  ...displaySettings,
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
