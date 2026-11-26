import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Bell,
  ChevronDown,
  FileText,
  LogOut,
  Mail,
  Menu,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppShellContext } from './app-window-shell';
import {
  DisplaySettingsPopover,
  persistDisplaySettings,
  readDisplaySettings,
  subscribeDisplaySettings,
  type DisplaySettingsState,
} from './display-settings-popover';
import { GmailMark } from './gmail-mark';
import { IconTooltip } from './icon-tooltip';

export type TopNavKey =
  | 'dashboard'
  | 'accounts'
  | 'tags'
  | 'transfer'
  | 'audit'
  | 'settings';

export const GLOBAL_TOP_NAV_ITEMS: readonly {
  key: TopNavKey;
  label: string;
  icon: typeof Mail;
}[] = [
  { key: 'accounts', label: '账号管理', icon: Mail },
  { key: 'tags', label: '标签管理', icon: Tag },
  { key: 'transfer', label: '导入 / 导出', icon: ArrowUpDown },
  { key: 'audit', label: '审计日志', icon: FileText },
  { key: 'settings', label: '系统设置', icon: Settings },
];

export function MobilePrimaryNavMenu({
  activeNav = 'accounts',
  onSelectNav,
}: {
  activeNav?: TopNavKey;
  onSelectNav: (key: TopNavKey) => void;
}) {
  return (
    <nav aria-label="主模块导航" className="flex flex-col gap-1">
      {GLOBAL_TOP_NAV_ITEMS.map(({ key, label, icon: Icon }) => {
        const active =
          activeNav === key || (key === 'accounts' && activeNav === 'dashboard');
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelectNav(key)}
            className={cn(
              'flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition-colors',
              active
                ? 'bg-[var(--accent)] text-[var(--primary-foreground)] font-semibold'
                : 'text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function GlassToolbar({
  activeNav = 'accounts',
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  displaySettingsOpen: controlledDisplayOpen,
  onDisplaySettingsOpenChange,
  onSelectNav,
  onOpenSecurity,
  onOpenRecoveryUsage,
  onOpenTransfer,
  onToggleShowcase,
  showcaseActive = false,
  onLogout,
  notificationCount,
  notifications = [],
  onClearNotifications,
}: {
  activeNav?: TopNavKey;
  navAlpha: number;
  onNavAlphaChange: (value: number) => void;
  displaySettings?: DisplaySettingsState;
  onDisplaySettingsChange?: (next: DisplaySettingsState) => void;
  displaySettingsOpen?: boolean;
  onDisplaySettingsOpenChange?: (open: boolean) => void;
  onSelectNav: (key: TopNavKey) => void;
  onOpenSecurity: () => void;
  onOpenRecoveryUsage?: () => void;
  onOpenTransfer?: () => void;
  onToggleShowcase?: () => void;
  showcaseActive?: boolean;
  onLogout: () => void;
  notificationCount?: number;
  notifications?: readonly string[];
  onClearNotifications?: () => void;
}) {
  const shell = useAppShellContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [uncontrolledDisplayOpen, setUncontrolledDisplayOpen] = useState(false);
  const [dismissedDigest, setDismissedDigest] = useState<string>('');
  const [internalDisplaySettings, setInternalDisplaySettings] =
    useState<DisplaySettingsState>(() => readDisplaySettings());

  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const displayBtnRef = useRef<HTMLButtonElement>(null);

  const displayOpen = controlledDisplayOpen ?? uncontrolledDisplayOpen;
  const setDisplayOpen = (next: boolean) => {
    setUncontrolledDisplayOpen(next);
    onDisplaySettingsOpenChange?.(next);
  };

  useEffect(() => subscribeDisplaySettings(setInternalDisplaySettings), []);

  const resolvedDisplaySettings = displaySettings ?? internalDisplaySettings;
  const handleDisplaySettingsChange = (next: DisplaySettingsState) => {
    setInternalDisplaySettings(next);
    if (onDisplaySettingsChange) {
      onDisplaySettingsChange(next);
    } else {
      persistDisplaySettings(next);
    }
  };

  const notifDigest = notifications.join('\n');
  const effectiveNotifications =
    notifDigest && notifDigest === dismissedDigest ? [] : notifications;
  const unreadCount =
    notificationCount ??
    (effectiveNotifications.length > 0 ? effectiveNotifications.length : 0);

  useEffect(() => {
    if (!menuOpen && !notifOpen) return;
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
        const wasMenu = menuOpen;
        const wasNotif = notifOpen;
        setMenuOpen(false);
        setNotifOpen(false);
        if (wasMenu) menuBtnRef.current?.focus();
        else if (wasNotif) notifBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, notifOpen]);

  return (
    <header
      data-slot="glass-toolbar"
      className="macos-nav-surface relative z-30 flex min-h-[58px] items-center justify-between gap-2.5 border-b border-[var(--nav-divider)] px-3.5 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.45)] sm:px-5"
    >
      {/* 左侧：移动端菜单按钮 + 统一品牌标志与名称 */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {shell?.hasSidebar && (
          <button
            type="button"
            aria-label="打开导航菜单"
            aria-expanded={shell.mobileSidebarOpen}
            onClick={shell.toggleMobileSidebar}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-control-hover)] lg:hidden"
          >
            <Menu className="size-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelectNav('accounts')}
          className="flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-0.5 text-left transition-opacity hover:opacity-85"
        >
          <GmailMark size="md" />
          <span className="truncate text-[14.5px] font-semibold tracking-tight text-[var(--text-primary)] sm:text-[15px]">
            Gmail 账号管理系统
          </span>
        </button>
      </div>

      {/* 中部：全站统一的一级模块主导航（桌面端显示，移动端收纳进抽屉） */}
      <nav
        aria-label="主导航"
        className="hidden items-center gap-0.5 rounded-2xl border border-[var(--nav-border)] bg-[var(--surface-control)] p-1 lg:flex xl:gap-1"
      >
        {GLOBAL_TOP_NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const active =
            activeNav === key ||
            (key === 'accounts' && activeNav === 'dashboard');
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectNav(key)}
              className={cn(
                'inline-flex h-8.5 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-all duration-[180ms] ease-out xl:px-3 xl:text-[13px]',
                active
                  ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.26)]'
                  : 'text-[var(--text-primary)]/90 hover:-translate-y-[0.5px] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 右侧：全站统一的全局工具区（外观/显示设置 + 通知 + 管理员菜单） */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative">
          <IconTooltip label="界面与显示设置" disabled={displayOpen}>
            <button
              ref={displayBtnRef}
              type="button"
              aria-label="界面与显示设置"
              aria-expanded={displayOpen}
              aria-haspopup="dialog"
              onClick={() => {
                setDisplayOpen(!displayOpen);
                setNotifOpen(false);
                setMenuOpen(false);
              }}
              className={cn(
                'inline-flex size-9 items-center justify-center rounded-full border transition-all duration-[180ms] ease-out hover:-translate-y-[1px]',
                displayOpen
                  ? 'border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent-text)] ring-2 ring-[var(--accent)]/20'
                  : 'border-[var(--surface-control-border)] bg-[var(--surface-control)] text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]',
              )}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </button>
          </IconTooltip>

          <DisplaySettingsPopover
            open={displayOpen}
            onClose={() => setDisplayOpen(false)}
            triggerRef={displayBtnRef}
            navAlpha={navAlpha}
            onNavAlphaChange={onNavAlphaChange}
            settings={resolvedDisplaySettings}
            onSettingsChange={handleDisplaySettingsChange}
          />
        </div>

        <div ref={notifRef} className="relative">
          <IconTooltip label="通知" disabled={notifOpen}>
            <button
              ref={notifBtnRef}
              type="button"
              aria-label="通知"
              aria-expanded={notifOpen}
              onClick={() => {
                setNotifOpen((open) => !open);
                setMenuOpen(false);
                setDisplayOpen(false);
              }}
              className="relative inline-flex size-9 items-center justify-center rounded-full border border-[var(--surface-control-border)] bg-[var(--surface-control)] text-[var(--text-primary)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--surface-control-hover)]"
            >
              <Bell className="size-4" aria-hidden="true" />
              {unreadCount > 0 && (
                <span
                  data-slot="notification-badge"
                  aria-hidden="true"
                  className="absolute top-1.5 right-2 size-2 rounded-full bg-[var(--danger)] ring-2 ring-[var(--surface-popover)]"
                />
              )}
            </button>
          </IconTooltip>
          {notifOpen && (
            <div
              role="region"
              aria-label="系统通知"
              className="macos-glass-modal absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-[var(--surface-popover)] p-3 text-xs text-[var(--text-primary)]"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">最近动态</p>
                {effectiveNotifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDismissedDigest(notifDigest);
                      onClearNotifications?.();
                    }}
                    className="text-[11px] font-medium text-[var(--accent-text)] hover:underline"
                  >
                    全部已读
                  </button>
                )}
              </div>
              {effectiveNotifications.length > 0 ? (
                <ul className="space-y-1.5">
                  {effectiveNotifications.map((item, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl bg-[var(--surface-control)] px-2.5 py-2 leading-5 text-[var(--text-primary)]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-[var(--surface-control)] px-2.5 py-2 text-[var(--text-secondary)]">
                  暂无未读通知。
                </p>
              )}
            </div>
          )}
        </div>

        <div ref={menuRef} className="relative">
          <IconTooltip label="管理员菜单" align="end" disabled={menuOpen}>
            <button
              ref={menuBtnRef}
              type="button"
              aria-label="管理员菜单"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((open) => !open);
                setNotifOpen(false);
                setDisplayOpen(false);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--surface-control-border)] bg-[var(--surface-control)] pr-2.5 pl-1.5 text-[13px] font-medium text-[var(--text-primary)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--surface-control-hover)]"
            >
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-text)]">
                <User className="size-3.5" aria-hidden="true" />
              </span>
              <span className="hidden sm:inline">管理员</span>
              <ChevronDown
                className="size-3.5 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
            </button>
          </IconTooltip>
          {menuOpen && (
            <div
              role="menu"
              aria-label="管理员操作菜单"
              className="macos-glass-modal absolute right-0 z-50 mt-2 w-52 rounded-2xl bg-[var(--surface-popover)] p-1.5 text-[13px] text-[var(--text-primary)]"
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
                <ShieldCheck className="size-4 text-[var(--accent-text)]" />
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
              {onOpenTransfer && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenTransfer();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <ArrowUpDown className="size-4 text-[var(--text-secondary)]" />
                  <span>导入 / 导出（CSV）</span>
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
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--danger-text)] transition-colors hover:bg-[var(--danger-soft)]"
              >
                <LogOut className="size-4" />
                <span>退出登录</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
