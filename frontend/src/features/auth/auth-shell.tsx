import { useEffect, useState, type ReactNode } from 'react';
import {
  Database,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import {
  GmailMark,
  persistDisplaySettings,
  readDisplaySettings,
  subscribeDisplaySettings,
  type DisplaySettingsState,
} from '@/components/macos';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { AuthNotice } from './use-auth-machine';

const SECURITY_HIGHLIGHTS = [
  {
    icon: LockKeyhole,
    tone: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    title: 'AES-256-GCM 字段级加密',
    desc: '密码、手机号与备注独立加密存储，敏感明文仅按需临时解密展示。',
  },
  {
    icon: Fingerprint,
    tone: 'bg-[var(--purple-soft)] text-[var(--purple-text)]',
    title: 'Passkey 与 TOTP 双重防护',
    desc: '支持通行密钥免密登录、验证器口令与默认 15 分钟闲置自动锁定。',
  },
  {
    icon: Database,
    tone: 'bg-[var(--success-soft)] text-[var(--success-text)]',
    title: '版本保护与防篡改审计',
    desc: '乐观锁防并发覆盖，关键操作写入哈希链审计日志并支持独立加密备份。',
  },
] as const;

const THEME_OPTIONS: readonly {
  mode: ThemeMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { mode: 'light', label: '浅色模式', icon: Sun },
  { mode: 'dark', label: '深色模式', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
];

export function AuthShell({
  title,
  showLogout,
  busy,
  notice,
  onLogout,
  children,
}: {
  title: string;
  showLogout: boolean;
  busy: boolean;
  notice: AuthNotice;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );

  useEffect(() => subscribeDisplaySettings(setDisplaySettings), []);

  const handleThemeChange = (themeMode: ThemeMode) => {
    const next = { ...displaySettings, themeMode };
    setDisplaySettings(next);
    persistDisplaySettings(next);
  };

  return (
    <div
      data-slot="auth-shell"
      data-flowing-bg={displaySettings.flowingBackground ? 'true' : 'false'}
      data-animations={displaySettings.animationsEnabled ? 'true' : 'false'}
      className="macos-desktop-bg relative flex min-h-screen w-full flex-col overflow-x-clip text-[var(--text-primary)]"
    >
      {/* 与工作区一致的纯矢量柔和光斑与波浪背景层 */}
      {displaySettings.flowingBackground && (
        <svg
          aria-hidden="true"
          data-slot="auth-flowing-background"
          viewBox="0 0 1728 1117"
          preserveAspectRatio="xMidYMid slice"
          className={cn(
            'pointer-events-none fixed inset-0 h-full w-full opacity-90',
            displaySettings.animationsEnabled && 'macos-flowing-bg',
          )}
        >
          <defs>
            <linearGradient
              id="gm-auth-wave-1"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.68" />
              <stop offset="50%" stopColor="#6DB2FF" stopOpacity="0.46" />
              <stop offset="100%" stopColor="#3B8BFF" stopOpacity="0.18" />
            </linearGradient>
            <linearGradient
              id="gm-auth-wave-2"
              x1="100%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#4A98FF" stopOpacity="0.52" />
              <stop offset="50%" stopColor="#8EC4FF" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
            </linearGradient>
            <radialGradient id="gm-auth-orb-1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="gm-auth-orb-2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5AA4FF" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#5AA4FF" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx="260"
            cy="180"
            rx="480"
            ry="340"
            fill="url(#gm-auth-orb-1)"
          />
          <ellipse
            cx="1440"
            cy="210"
            rx="520"
            ry="340"
            fill="url(#gm-auth-orb-2)"
          />
          <path
            d="M-120 700 C 260 480, 620 920, 1080 560 C 1380 340, 1580 520, 1880 280 L 1880 1200 L -120 1200 Z"
            fill="url(#gm-auth-wave-1)"
          />
          <path
            d="M360 -80 C 700 260, 1120 60, 1440 390 C 1640 570, 1780 610, 1900 540 L 1900 -120 Z"
            fill="url(#gm-auth-wave-2)"
          />
        </svg>
      )}

      {/* 顶部磨砂导航条：复用工作区品牌标志与深浅色切换 */}
      <header className="macos-nav-surface relative z-20 border-b border-[var(--nav-divider)]">
        <div className="mx-auto flex min-h-[58px] max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <GmailMark size="md" />
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                Gmail 账号管理
              </span>
              <span className="hidden rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-text)] sm:inline-flex">
                安全工作区
              </span>
            </div>
          </div>

          <div
            role="group"
            aria-label="外观主题切换"
            className="inline-flex items-center rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-0.5"
          >
            {THEME_OPTIONS.map(({ mode, label, icon: Icon }) => {
              const active = displaySettings.themeMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  title={label}
                  onClick={() => handleThemeChange(mode)}
                  className={cn(
                    'inline-flex size-7 items-center justify-center rounded-lg transition-all duration-150',
                    active
                      ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_3px_10px_rgba(15,98,223,0.28)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* 居中 macOS 亚克力分栏登录窗口 */}
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-8 sm:px-8 sm:py-12">
        <div className="grid w-full overflow-hidden rounded-[26px] border border-[var(--window-border)] bg-[var(--panel-bg)] shadow-[var(--window-shadow)] backdrop-blur-2xl lg:grid-cols-[1.05fr_1fr]">
          {/* 左侧：品牌叙事与安全基线卡片 */}
          <aside className="flex flex-col justify-between gap-7 border-b border-[var(--nav-divider)] bg-[var(--main-tint)] p-6 sm:p-8 lg:border-r lg:border-b-0 lg:p-10">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-3 py-1 text-xs font-semibold text-[var(--badge-blue-text)]">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                <span>私有加密凭据工作区</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-[28px] leading-tight font-bold tracking-tight text-[var(--text-primary)] sm:text-[32px]">
                  账号资料，
                  <br className="hidden sm:block" />
                  从安全开始。
                </h1>
                <p className="max-w-md text-[13.5px] leading-6 text-[var(--text-secondary)]">
                  仅供管理员使用。通过主密码、验证器或通行密钥解锁受保护的 Gmail
                  账号与第三方应用注册档案。
                </p>
              </div>

              <ul className="space-y-2.5 pt-1" aria-label="工作区安全特性">
                {SECURITY_HIGHLIGHTS.map(
                  ({ icon: Icon, tone, title: itemTitle, desc }) => (
                    <li
                      key={itemTitle}
                      className="macos-glass-panel flex items-start gap-3 rounded-2xl p-3.5"
                    >
                      <span
                        className={cn(
                          'inline-flex size-9 shrink-0 items-center justify-center rounded-xl',
                          tone,
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                          {itemTitle}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
                          {desc}
                        </p>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
              <span>请勿在公共设备上保存凭据，离开时请及时锁屏或退出。</span>
            </div>
          </aside>

          {/* 右侧：高对比毛玻璃认证卡片 */}
          <section
            aria-labelledby="auth-title"
            className="macos-glass-modal flex min-w-0 flex-col justify-center border-0 p-6 shadow-none sm:p-8 lg:p-10"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <h2
                  id="auth-title"
                  className="text-2xl font-bold tracking-tight text-[var(--text-primary)]"
                >
                  {title}
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {title === '管理员登录'
                    ? '验证身份后进入账号与资产控制台'
                    : title === '绑定二步验证'
                      ? '完成二步验证绑定以激活完整工作区权限'
                      : title === '保存你的恢复码'
                        ? '请妥善离线备份一次性应急恢复码'
                        : '确认身份后管理安全会话与凭据'}
                </p>
              </div>
              {showLogout && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={onLogout}
                  className="rounded-xl"
                >
                  退出
                </Button>
              )}
            </div>

            {notice.message && (
              <Alert
                variant={notice.kind === 'success' ? 'default' : 'destructive'}
                role={notice.kind === 'success' ? 'status' : 'alert'}
                className="mb-5 rounded-xl"
              >
                <AlertDescription>{notice.message}</AlertDescription>
              </Alert>
            )}

            {children}
          </section>
        </div>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-center gap-2 px-4 pb-6 text-xs text-[var(--text-secondary)] sm:px-8">
        <LockKeyhole className="size-3.5" aria-hidden="true" />
        <span>端到端受保护连接 · 默认闲置 15 分钟自动锁定</span>
      </footer>
    </div>
  );
}
