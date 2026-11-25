import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Bell,
  ChevronDown,
  FileText,
  Home,
  LogOut,
  Mail,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GmailMark } from './gmail-mark';
import { MacTrafficLights } from './mac-traffic-lights';
import { NavigationOpacitySlider } from './navigation-opacity-slider';

export type TopNavKey =
  'dashboard' | 'accounts' | 'tags' | 'transfer' | 'audit' | 'settings';

const navItems: readonly {
  key: TopNavKey;
  label: string;
  icon: typeof Mail;
}[] = [
  { key: 'dashboard', label: '控制台', icon: Home },
  { key: 'accounts', label: '账号管理', icon: Mail },
  { key: 'tags', label: '标签管理', icon: Tag },
  { key: 'transfer', label: '导入 / 导出', icon: ArrowUpDown },
  { key: 'audit', label: '审计日志', icon: FileText },
  { key: 'settings', label: '系统设置', icon: Settings },
];

export function GlassToolbar({
  activeNav = 'accounts',
  navAlpha,
  onNavAlphaChange,
  onSelectNav,
  onOpenSecurity,
  onOpenRecoveryUsage,
  onToggleShowcase,
  showcaseActive = false,
  onLogout,
  notificationCount = 1,
  notifications = [],
}: {
  activeNav?: TopNavKey;
  navAlpha: number;
  onNavAlphaChange: (value: number) => void;
  onSelectNav: (key: TopNavKey) => void;
  onOpenSecurity: () => void;
  onOpenRecoveryUsage?: () => void;
  onToggleShowcase?: () => void;
  showcaseActive?: boolean;
  onLogout: () => void;
  notificationCount?: number;
  notifications?: string[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (
        notifRef.current &&
        !notifRef.current.contains(event.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <header
      data-slot="glass-toolbar"
      className="macos-nav-surface relative z-30 flex min-h-[72px] flex-wrap items-center justify-between gap-2 border-b border-[var(--nav-divider)] px-3.5 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.65)] xl:flex-nowrap xl:gap-3 xl:px-4 2xl:px-5"
    >
      {/* 左侧：红黄绿交通灯 + Gmail 标志与系统标题 */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex flex-col gap-1">
          <MacTrafficLights />
          <div className="flex items-center gap-2">
            <GmailMark size="md" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14.5px] font-semibold tracking-tight text-[var(--text-primary)] 2xl:text-[15px]">
                Gmail 账号管理系统
              </p>
              <p className="max-w-[162px] truncate text-[11px] font-normal text-[var(--text-secondary)] 2xl:max-w-none">
                私人部署 · Gmail 账号资料与凭据管理
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 中部：主导航 */}
      <nav
        aria-label="主导航"
        className="flex flex-wrap items-center gap-0.5 rounded-2xl bg-white/30 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] xl:flex-nowrap xl:gap-1"
      >
        {navItems.map(({ key, label, icon: Icon }) => {
          const active = activeNav === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectNav(key)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-all duration-[180ms] ease-out 2xl:px-3 2xl:text-[13px]',
                active
                  ? 'border border-white/45 bg-[linear-gradient(180deg,rgba(18,104,226,0.96),rgba(13,86,196,0.98))] text-white shadow-[0_6px_18px_rgba(22,119,255,0.28),inset_0_1px_0_rgba(255,255,255,0.34)]'
                  : 'text-[var(--text-primary)]/90 hover:-translate-y-[1px] hover:bg-white/60 hover:text-[var(--text-primary)]',
              )}
            >
              <Icon
                className="size-3.5 shrink-0 2xl:size-4"
                aria-hidden="true"
              />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 右侧：导航栏毛玻璃透明度滑块 + 通知 + 管理员菜单 */}
      <div className="flex shrink-0 items-center gap-2 2xl:gap-2.5">
        <NavigationOpacitySlider value={navAlpha} onChange={onNavAlphaChange} />

        <div ref={notifRef} className="relative">
          <button
            type="button"
            aria-label="通知"
            aria-expanded={notifOpen}
            onClick={() => {
              setNotifOpen((open) => !open);
              setMenuOpen(false);
            }}
            className="relative inline-flex size-9 items-center justify-center rounded-full border border-white/75 bg-white/55 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/80"
          >
            <Bell className="size-4" aria-hidden="true" />
            {notificationCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-2 size-2 rounded-full bg-[var(--danger)] ring-2 ring-white"
              />
            )}
          </button>
          {notifOpen && (
            <div
              role="region"
              aria-label="系统通知"
              className="macos-glass-modal absolute right-0 z-50 mt-2 w-72 rounded-2xl p-3 text-xs text-[var(--text-primary)]"
            >
              <p className="mb-2 text-[13px] font-semibold">最近动态</p>
              {notifications.length > 0 ? (
                <ul className="space-y-1.5">
                  {notifications.map((item, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl bg-white/60 px-2.5 py-2 leading-5 text-[var(--text-primary)]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-white/55 px-2.5 py-2 text-[var(--text-secondary)]">
                  所有审计链与凭据加密状态正常。
                </p>
              )}
            </div>
          )}
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="管理员菜单"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
              setNotifOpen(false);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/75 bg-white/55 pr-2.5 pl-1.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/80"
          >
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <User className="size-3.5" aria-hidden="true" />
            </span>
            <span>管理员</span>
            <ChevronDown
              className="size-3.5 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="管理员操作菜单"
              className="macos-glass-modal absolute right-0 z-50 mt-2 w-52 rounded-2xl p-1.5 text-[13px] text-[var(--text-primary)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSecurity();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
              >
                <ShieldCheck className="size-4 text-[var(--accent)]" />
                <span>安全设置</span>
              </button>
              {onOpenRecoveryUsage && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenRecoveryUsage();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <Mail className="size-4 text-[var(--text-secondary)]" />
                  <span>辅助邮箱使用情况</span>
                </button>
              )}
              {onToggleShowcase && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleShowcase();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <SlidersHorizontal className="size-4 text-[var(--text-secondary)]" />
                  <span>
                    {showcaseActive ? '隐藏状态展示区' : '显示状态展示区'}
                  </span>
                </button>
              )}
              <div className="my-1 h-px bg-[var(--table-divider)]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)]"
              >
                <LogOut className="size-4" />
                <span>退出</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
