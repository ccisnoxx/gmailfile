import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Search, X } from 'lucide-react';
import {
  AppWindowShell,
  GlassToolbar,
  PrimarySidebar,
  type DisplaySettingsState,
  type SidebarCounts,
  type SidebarSectionKey,
  type SidebarSystemStatus,
  type SidebarTagItem,
  type TopNavKey,
  type WorkspaceNavKey,
} from '@/components/macos';
import { cn } from '@/lib/utils';
import type { SettingsSectionKey, SystemRuntimeInfo } from './types';

export type SettingsToast = {
  message: string;
  kind: 'success' | 'error' | 'info';
};

export function SettingsLayout({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  activeSection,
  onSelectSection,
  onSelectWorkspaceNav,
  onSelectAccountSection,
  onSelectTag,
  sidebarCounts,
  sidebarTags,
  searchQuery,
  onSearchQueryChange,
  runtime,
  totpEnabled,
  lastBackupLabel,
  notifications = [],
  onOpenSecurity,
  onOpenRecoveryUsage,
  onLogout,
  headerActions,
  segmentedTabs,
  toast,
  onDismissToast,
  children,
}: {
  navAlpha: number;
  onNavAlphaChange?: (value: number) => void;
  displaySettings: DisplaySettingsState;
  onDisplaySettingsChange?: (next: DisplaySettingsState) => void;
  activeSection: SettingsSectionKey;
  onSelectSection: (section: SettingsSectionKey) => void;
  onSelectWorkspaceNav: (key: WorkspaceNavKey) => void;
  onSelectAccountSection?: (section: SidebarSectionKey) => void;
  onSelectTag?: (tagId: string) => void;
  sidebarCounts?: SidebarCounts;
  sidebarTags?: SidebarTagItem[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  runtime: SystemRuntimeInfo;
  totpEnabled?: boolean;
  lastBackupLabel?: string;
  notifications?: string[];
  onOpenSecurity?: () => void;
  onOpenOperations?: () => void;
  onOpenRecoveryUsage?: () => void;
  onLogout: () => void;
  headerActions?: React.ReactNode;
  segmentedTabs: React.ReactNode;
  toast?: SettingsToast | null;
  onDismissToast?: () => void;
  children: React.ReactNode;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K 聚焦设置搜索框（不劫持浏览器原生 ⌘F，且弹窗打开时避让）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sidebarStatus: SidebarSystemStatus = {
    healthy: runtime.healthy,
    headline: runtime.statusText,
    csrfEnabled: true,
    encryptionLabel: '字段加密 AES-256-GCM',
    totpEnabled,
    lastBackupLabel: lastBackupLabel ?? '尚未运行',
    version: runtime.appVersion,
  };

  const activeTopNav: TopNavKey =
    activeSection === 'audit' ? 'audit' : 'settings';

  const handleTopNav = (key: TopNavKey) => {
    if (key === 'audit') {
      onSelectSection('audit');
      return;
    }
    if (key === 'settings') {
      onSelectSection('security');
      return;
    }
    onSelectWorkspaceNav(key);
  };

  const toolbar = (
    <GlassToolbar
      activeNav={activeTopNav}
      navAlpha={navAlpha}
      onNavAlphaChange={onNavAlphaChange ?? (() => {})}
      displaySettings={displaySettings}
      onDisplaySettingsChange={onDisplaySettingsChange}
      onSelectNav={handleTopNav}
      onOpenSecurity={() => {
        if (onOpenSecurity) onOpenSecurity();
        else onSelectSection('security');
      }}
      onOpenRecoveryUsage={onOpenRecoveryUsage}
      onOpenTransfer={() => onSelectWorkspaceNav('transfer')}
      onLogout={onLogout}
      notifications={notifications}
    />
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
          activeNav={
            activeSection === 'audit'
              ? 'audit'
              : activeSection === 'backup'
                ? 'backup'
                : 'settings'
          }
          counts={sidebarCounts}
          tags={sidebarTags}
          trashCount={runtime.trashCount}
          systemStatus={sidebarStatus}
          onSelectNav={onSelectWorkspaceNav}
          onSelectSection={onSelectAccountSection}
          onSelectTag={onSelectTag}
        />
      }
      mainClassName="flex-col gap-4 p-4 sm:p-5 lg:p-6"
    >
      {/* 主区域顶部标题、搜索与操作 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
              系统设置
            </h1>
            <span
              data-slot="topbar-system-status"
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium',
                runtime.healthy
                  ? 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
                  : 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  runtime.healthy
                    ? 'bg-[var(--success)]'
                    : 'bg-[var(--danger)]',
                )}
              />
              <span>{runtime.statusText}</span>
            </span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            安全、备份、审计与系统行为配置
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex w-56 items-center sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="搜索设置"
              placeholder="搜索设置（⌘/Ctrl K）"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              maxLength={120}
              className="h-9 w-full rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] pr-8 pl-9 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:bg-[var(--surface-control-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="清空设置搜索"
                onClick={() => onSearchQueryChange('')}
                className="absolute right-2 inline-flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {headerActions}
        </div>
      </div>

      {/* 顶部 macOS segmented control（唯一分类导航，消除侧栏重复） */}
      {segmentedTabs}

      {/* 主内容区域 */}
      <div className="min-w-0 flex-1">{children}</div>

      {/* 轻量玻璃 Toast（Portal 渲染于 body，z-[70] 适配暗色高对比） */}
      {toast &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role={toast.kind === 'error' ? 'alert' : 'status'}
            aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
            data-slot="settings-toast"
            className={cn(
              'fixed right-6 bottom-6 z-[70] flex max-w-[min(28rem,calc(100vw-3rem))] items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-[13px] font-medium shadow-[0_16px_40px_rgba(15,30,58,0.28)] backdrop-blur-xl',
              toast.kind === 'error'
                ? 'border-[var(--badge-red-border)] bg-[var(--surface-toast-error)] text-[var(--badge-red-text)]'
                : toast.kind === 'success'
                  ? 'border-[var(--badge-green-border)] bg-[var(--surface-toast-success)] text-[var(--badge-green-text)]'
                  : 'border-[var(--modal-border)] bg-[var(--surface-toast)] text-[var(--text-primary)]',
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
