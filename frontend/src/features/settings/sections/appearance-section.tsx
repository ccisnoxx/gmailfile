import { Keyboard } from 'lucide-react';
import { AppearanceCard } from '../appearance-card';
import { SettingsCardShell } from '../settings-card-shell';
import type { SettingsSectionCommonProps } from './section-shared';

export default function AppearanceSettingsSection({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
}: SettingsSectionCommonProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <AppearanceCard
        navAlpha={navAlpha}
        onNavAlphaChange={onNavAlphaChange}
        displaySettings={displaySettings}
        onDisplaySettingsChange={onDisplaySettingsChange}
        showDisplayToggles={true}
      />
      <SettingsCardShell
        title="交互快捷键与本地存储约束"
        subtitle="键盘可达性支持与浏览器偏好隔离原则"
        icon={<Keyboard className="size-4" />}
      >
        <dl className="space-y-2.5 rounded-2xl border border-white/75 bg-white/44 p-3.5 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--text-secondary)]">聚焦设置搜索</dt>
            <dd className="rounded-md border border-[var(--border)] bg-white/80 px-2 py-0.5 font-mono text-[12px]">
              ⌘K / Ctrl+K
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--text-secondary)]">切换分类标签</dt>
            <dd className="rounded-md border border-[var(--border)] bg-white/80 px-2 py-0.5 font-mono text-[12px]">
              ← / → / Home / End
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--text-secondary)]">关闭弹窗与抽屉</dt>
            <dd className="rounded-md border border-[var(--border)] bg-white/80 px-2 py-0.5 font-mono text-[12px]">
              Esc
            </dd>
          </div>
        </dl>
        <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
          本地存储（localStorage）仅保存导航栏透明度、流动背景、动画开关、紧凑模式、账号表格列显示及已保存筛选视图等非敏感界面偏好，绝不保存任何密码、TOTP
          密钥或恢复码。
        </p>
      </SettingsCardShell>
    </div>
  );
}
