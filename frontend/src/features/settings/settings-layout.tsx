import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  LogOut,
  Search,
  ShieldCheck,
  User,
  Wrench,
  X,
} from 'lucide-react';
import {
  AppWindowShell,
  MacTrafficLights,
  PrimarySidebar,
  type DisplaySettingsState,
  type SidebarSystemStatus,
  type WorkspaceNavKey,
} from '@/components/macos';
import { cn } from '@/lib/utils';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionKey,
  type SystemRuntimeInfo,
} from './types';

export type SettingsToast = {
  message: string;
  kind: 'success' | 'error' | 'info';
};

export function SettingsLayout({
  navAlpha,
  displaySettings,
  activeSection,
  onSelectSection,
  onSelectWorkspaceNav,
  searchQuery,
  onSearchQueryChange,
  runtime,
  lastBackupLabel,
  notifications = [],
  onOpenSecurity,
  onOpenOperations,
  onLogout,
  headerActions,
  segmentedTabs,
  toast,
  onDismissToast,
  children,
}: {
  navAlpha: number;
  displaySettings: DisplaySettingsState;
  activeSection: SettingsSectionKey;
  onSelectSection: (section: SettingsSectionKey) => void;
  onSelectWorkspaceNav: (key: WorkspaceNavKey) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  runtime: SystemRuntimeInfo;
  lastBackupLabel?: string;
  notifications?: string[];
  onOpenSecurity?: () => void;
  onOpenOperations?: () => void;
  onLogout: () => void;
  headerActions?: React.ReactNode;
  segmentedTabs: React.ReactNode;
  toast?: SettingsToast | null;
  onDismissToast?: () => void;
  children: React.ReactNode;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const adminBtnRef = useRef<HTMLButtonElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const adminRef = useRef<HTMLDivElement>(null);

  // ⌘F / Ctrl+F 聚焦顶部设置搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 点击外部或按 Escape 关闭顶部下拉菜单
  useEffect(() => {
    if (!notifOpen && !adminMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (adminRef.current && !adminRef.current.contains(target)) {
        setAdminMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        const wasAdmin = adminMenuOpen;
        const wasNotif = notifOpen;
        setNotifOpen(false);
        setAdminMenuOpen(false);
        if (wasAdmin) adminBtnRef.current?.focus();
        else if (wasNotif) notifBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [adminMenuOpen, notifOpen]);

  const sidebarStatus: SidebarSystemStatus = {
    healthy: runtime.healthy,
    headline: runtime.statusText,
    httpsEnabled: true,
    csrfEnabled: true,
    encryptionLabel: '字段加密 AES-256-GCM',
    totpEnabled: true,
    lastBackupLabel: lastBackupLabel ?? '2026-11-25 02:30',
    version: runtime.appVersion,
  };

  const toolbar = (
    <header
      data-slot="settings-window-toolbar"
      className="macos-nav-surface relative z-30 flex min-h-[58px] flex-wrap items-center justify-between gap-3 border-b border-[var(--nav-divider)] px-4 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.65)] sm:px-5"
    >
      {/* 左侧：macOS 交通灯 */}
      <div className="flex shrink-0 items-center gap-3 lg:w-[196px]">
        <MacTrafficLights />
      </div>

      {/* 顶部中间：设置搜索框（⌘F） */}
      <div className="relative flex w-full max-w-[420px] flex-1 items-center">
        <Search
          className="pointer-events-none absolute left-3.5 size-4 text-[var(--text-secondary)]"
          aria-hidden="true"
        />
        <input
          ref={searchInputRef}
          type="search"
          aria-label="搜索设置"
          placeholder="搜索设置（⌘F）"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          maxLength={120}
          className="h-9 w-full rounded-full border border-white/82 bg-white/60 pr-9 pl-10 text-[13px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_10px_rgba(45,86,138,0.05)] backdrop-blur-md transition-all duration-[180ms] ease-out placeholder:text-[var(--text-secondary)] focus:bg-white/88 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
        {searchQuery && (
          <button
            type="button"
            aria-label="清空设置搜索"
            onClick={() => onSearchQueryChange('')}
            className="absolute right-2 inline-flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-white/80 hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* 右上角：系统正常运行 + 通知 + 管理员头像 */}
      <div className="flex shrink-0 items-center gap-2">
        <span
          data-slot="topbar-system-status"
          className={cn(
            'hidden h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:inline-flex',
            runtime.healthy
              ? 'border-[#2fbf71]/28 bg-white/72 text-[#147240]'
              : 'border-[#e45d5d]/30 bg-[#fff5f5]/90 text-[#b43636]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              runtime.healthy
                ? 'bg-[var(--success)] shadow-[0_0_0_3px_rgba(47,191,113,0.16)]'
                : 'bg-[var(--danger)] shadow-[0_0_0_3px_rgba(228,93,93,0.16)]',
            )}
          />
          <span>{runtime.statusText}</span>
        </span>

        {/* 通知 */}
        <div ref={notifRef} className="relative">
          <button
            ref={notifBtnRef}
            type="button"
            aria-label="通知"
            aria-expanded={notifOpen}
            onClick={() => {
              setNotifOpen((open) => !open);
              setAdminMenuOpen(false);
            }}
            className="relative inline-flex size-9 items-center justify-center rounded-full border border-white/75 bg-white/55 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/82"
          >
            <Bell className="size-4" aria-hidden="true" />
            {notifications.length > 0 && (
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
              className="macos-glass-modal absolute right-0 z-50 mt-2.5 w-72 max-w-[calc(100vw-2rem)] rounded-[18px] p-3 text-xs text-[var(--text-primary)]"
            >
              <p className="mb-2 text-[13px] font-semibold">系统安全动态</p>
              {notifications.length > 0 ? (
                <ul className="space-y-1.5">
                  {notifications.map((item, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl bg-white/62 px-2.5 py-2 leading-5 text-[var(--text-primary)]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-white/55 px-2.5 py-2 text-[var(--text-secondary)]">
                  所有审计链与加密备份校验均处于正常状态。
                </p>
              )}
            </div>
          )}
        </div>

        {/* 管理员头像与菜单 */}
        <div ref={adminRef} className="relative">
          <button
            ref={adminBtnRef}
            type="button"
            aria-label="管理员菜单"
            aria-expanded={adminMenuOpen}
            onClick={() => {
              setAdminMenuOpen((open) => !open);
              setNotifOpen(false);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/75 bg-white/55 pr-2.5 pl-1.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/82"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              <User className="size-3.5" />
            </span>
            <span>管理员</span>
            <ChevronDown
              className="size-3.5 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
          </button>

          {adminMenuOpen && (
            <div
              role="menu"
              aria-label="管理员操作菜单"
              className="macos-glass-modal absolute right-0 z-50 mt-2.5 w-48 rounded-[18px] p-1.5 text-[13px] text-[var(--text-primary)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdminMenuOpen(false);
                  if (onOpenSecurity) onOpenSecurity();
                  else onSelectSection('security');
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
              >
                <ShieldCheck className="size-4 text-[var(--accent)]" />
                <span>安全与认证</span>
              </button>
              {onOpenOperations && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAdminMenuOpen(false);
                    onOpenOperations();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <Wrench className="size-4 text-[var(--text-secondary)]" />
                  <span>迁移与运维</span>
                </button>
              )}
              <div className="my-1 h-px bg-[var(--table-divider)]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdminMenuOpen(false);
                  onLogout();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[#c54646] transition-colors hover:bg-[var(--danger-soft)]"
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

  return (
    <AppWindowShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      toolbar={toolbar}
      sidebar={
        <PrimarySidebar
          mode="workspace"
          activeNav="settings"
          trashCount={runtime.trashCount}
          systemStatus={sidebarStatus}
          onSelectNav={onSelectWorkspaceNav}
          secondaryNav={{
            title: '系统设置',
            ariaLabel: '系统设置二级导航',
            items: SETTINGS_SECTIONS.map((item) => ({
              key: item.key,
              label: item.label,
            })),
            activeKey: activeSection,
            onSelect: (key) => onSelectSection(key as SettingsSectionKey),
          }}
        />
      }
      mainClassName="flex-col gap-4 p-4 sm:p-5 lg:p-6"
    >
      {/* 主区域顶部标题与操作 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
            系统设置
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            安全、备份、审计与系统行为配置
          </p>
        </div>
        {headerActions && (
          <div className="flex flex-wrap items-center gap-2">
            {headerActions}
          </div>
        )}
      </div>

      {/* 顶部 macOS segmented control */}
      {segmentedTabs}

      {/* 主内容区域 */}
      <div className="min-w-0 flex-1">{children}</div>

      {/* 轻量玻璃 Toast 提示（Portal 渲染于 body，z-40 位于顶栏 z-30 之上、模态框 z-50 之下，避免受 backdrop-filter 裁切） */}
      {toast &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role={toast.kind === 'error' ? 'alert' : 'status'}
            aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
            data-slot="settings-toast"
            className={cn(
              'fixed right-6 bottom-6 z-40 flex max-w-[min(28rem,calc(100vw-3rem))] items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-[13px] font-medium shadow-[0_16px_40px_rgba(32,68,118,0.2),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl',
              toast.kind === 'error'
                ? 'border-[#e45d5d]/35 bg-[rgba(255,246,246,0.94)] text-[#a83838]'
                : toast.kind === 'success'
                  ? 'border-[#2fbf71]/32 bg-[rgba(246,253,249,0.94)] text-[#14683b]'
                  : 'border-white/88 bg-[rgba(250,253,255,0.94)] text-[var(--text-primary)]',
            )}
          >
            {toast.kind === 'error' ? (
              <AlertTriangle
                className="size-4 shrink-0 text-[var(--danger)]"
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2
                className={cn(
                  'size-4 shrink-0',
                  toast.kind === 'success'
                    ? 'text-[var(--success)]'
                    : 'text-[var(--accent)]',
                )}
                aria-hidden="true"
              />
            )}
            <span className="leading-5">{toast.message}</span>
            {onDismissToast && (
              <button
                type="button"
                aria-label="关闭提示"
                onClick={onDismissToast}
                className="ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>,
          document.body,
        )}
    </AppWindowShell>
  );
}
