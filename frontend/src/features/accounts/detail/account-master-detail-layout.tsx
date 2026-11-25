import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Home,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react';
import {
  AppWindowShell,
  DisplaySettingsPopover,
  MacTrafficLights,
  PrimarySidebar,
  type DisplaySettingsState,
  type SidebarSystemStatus,
  type WorkspaceNavKey,
} from '@/components/macos';
import { cn } from '@/lib/utils';

export function AccountMasterDetailLayout({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  displaySettingsOpen,
  onDisplaySettingsOpenChange,
  searchQuery,
  onSearchQueryChange,
  activeNav = 'accounts',
  onSelectNav,
  trashCount = 3,
  systemStatus,
  notifications = [],
  onOpenSecurity,
  onOpenOperations,
  onLogout,
  onNavigateAccountsList,
  breadcrumbCurrent = '账号详情',
  listPane,
  detailContent,
  toastMessage,
}: {
  navAlpha: number;
  onNavAlphaChange: (value: number) => void;
  displaySettings: DisplaySettingsState;
  onDisplaySettingsChange: (next: DisplaySettingsState) => void;
  displaySettingsOpen: boolean;
  onDisplaySettingsOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  activeNav?: WorkspaceNavKey;
  onSelectNav: (key: WorkspaceNavKey) => void;
  trashCount?: number;
  systemStatus?: SidebarSystemStatus;
  notifications?: string[];
  onOpenSecurity: () => void;
  onOpenOperations?: () => void;
  onLogout: () => void;
  onNavigateAccountsList: () => void;
  breadcrumbCurrent?: string;
  listPane: React.ReactNode;
  detailContent: React.ReactNode;
  toastMessage?: string;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const adminBtnRef = useRef<HTMLButtonElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const adminRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K 聚焦顶部全局搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 点击外部或按 Escape 关闭通知与管理员下拉菜单
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

  const toolbar = (
    <header
      data-slot="detail-window-toolbar"
      className="macos-nav-surface relative z-30 flex min-h-[58px] items-center justify-between gap-3 border-b border-[var(--nav-divider)] px-4 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.65)] sm:px-5"
    >
      {/* 左侧：macOS 交通灯 */}
      <div className="flex shrink-0 items-center gap-3 lg:w-[196px]">
        <MacTrafficLights />
      </div>

      {/* 顶部居中：全局搜索框 */}
      <div className="relative flex w-full max-w-[440px] flex-1 items-center">
        <Search
          className="pointer-events-none absolute left-3.5 size-4 text-[var(--text-secondary)]"
          aria-hidden="true"
        />
        <input
          ref={searchInputRef}
          type="search"
          aria-label="全局搜索账号、标签或备注"
          placeholder="搜索账号、标签或备注（⌘K）"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          maxLength={254}
          className="h-9 w-full rounded-full border border-white/82 bg-white/62 pr-4 pl-10 text-[13px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_10px_rgba(45,86,138,0.05)] backdrop-blur-md transition-all duration-[180ms] ease-out placeholder:text-[var(--text-secondary)] focus:bg-white/92 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
      </div>

      {/* 右侧：通知、设置、管理员头像与下拉菜单 */}
      <div className="flex shrink-0 items-center gap-2">
        {/* 通知按钮 */}
        <div ref={notifRef} className="relative">
          <button
            ref={notifBtnRef}
            type="button"
            aria-label="通知"
            aria-expanded={notifOpen}
            onClick={() => {
              setNotifOpen((open) => !open);
              setAdminMenuOpen(false);
              onDisplaySettingsOpenChange(false);
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
              className="macos-glass-modal absolute right-0 z-50 mt-2.5 w-72 rounded-[18px] p-3 text-xs text-[var(--text-primary)]"
            >
              <p className="mb-2 text-[13px] font-semibold">最近动态</p>
              {notifications.length > 0 ? (
                <ul className="space-y-1.5">
                  {notifications.map((item, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl bg-white/65 px-2.5 py-2 leading-5 text-[var(--text-primary)]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-white/55 px-2.5 py-2 text-[var(--text-secondary)]">
                  系统运行正常，加密与审计链校验通过。
                </p>
              )}
            </div>
          )}
        </div>

        {/* 设置按钮 + 界面与显示浮层 */}
        <div className="relative">
          <button
            ref={settingsBtnRef}
            type="button"
            aria-label="界面与显示设置"
            aria-expanded={displaySettingsOpen}
            aria-haspopup="dialog"
            onClick={() => {
              onDisplaySettingsOpenChange(!displaySettingsOpen);
              setNotifOpen(false);
              setAdminMenuOpen(false);
            }}
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px]',
              displaySettingsOpen
                ? 'border-[#1677ff]/35 bg-[#eaf3ff] text-[var(--accent)] ring-2 ring-[#1677ff]/18'
                : 'border-white/75 bg-white/55 text-[var(--text-primary)] hover:bg-white/82',
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
          </button>

          <DisplaySettingsPopover
            open={displaySettingsOpen}
            onClose={() => onDisplaySettingsOpenChange(false)}
            triggerRef={settingsBtnRef}
            navAlpha={navAlpha}
            onNavAlphaChange={onNavAlphaChange}
            settings={displaySettings}
            onSettingsChange={onDisplaySettingsChange}
          />
        </div>

        {/* 管理员头像与下拉菜单 */}
        <div ref={adminRef} className="relative">
          <button
            ref={adminBtnRef}
            type="button"
            aria-label="管理员菜单"
            aria-expanded={adminMenuOpen}
            onClick={() => {
              setAdminMenuOpen((open) => !open);
              setNotifOpen(false);
              onDisplaySettingsOpenChange(false);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/75 bg-white/55 pr-2.5 pl-1.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/82"
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

          {adminMenuOpen && (
            <div
              role="menu"
              aria-label="管理员下拉菜单"
              className="macos-glass-modal absolute right-0 z-50 mt-2.5 w-48 rounded-[18px] p-1.5 text-[13px] text-[var(--text-primary)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdminMenuOpen(false);
                  onOpenSecurity();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
              >
                <ShieldCheck className="size-4 text-[var(--accent)]" />
                <span>安全设置</span>
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
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)]"
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
          activeNav={activeNav}
          trashCount={trashCount}
          systemStatus={systemStatus}
          onSelectNav={onSelectNav}
        />
      }
      outerClassName="px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5"
      mainClassName="flex-col gap-[var(--detail-gap,16px)] p-3.5 xl:flex-row lg:p-4"
    >
      {/* 中间栏：账号列表（宽约 320px） */}
      {listPane}

      {/* 右侧栏：面包屑 + 账号详情（自适应填满剩余空间） */}
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--detail-gap,16px)]">
        <nav
          aria-label="面包屑导航"
          className="flex items-center gap-1.5 px-1 text-xs text-[var(--text-secondary)]"
        >
          <button
            type="button"
            aria-label="返回控制台"
            onClick={onNavigateAccountsList}
            className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-white/60 hover:text-[var(--text-primary)]"
          >
            <Home className="size-3.5" aria-hidden="true" />
          </button>
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
          <button
            type="button"
            onClick={onNavigateAccountsList}
            className="inline-flex min-h-6 items-center rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-white/60 hover:text-[var(--accent)]"
          >
            Gmail 账号
          </button>
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
          <span
            aria-current="page"
            className="font-semibold text-[var(--text-primary)]"
          >
            {breadcrumbCurrent}
          </span>
        </nav>

        {detailContent}
      </div>

      {/* 轻量玻璃 Toast 提示 */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          data-slot="detail-toast"
          className="pointer-events-none fixed right-6 bottom-6 z-50 flex items-center gap-2 rounded-2xl border border-white/88 bg-[rgba(250,253,255,0.92)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_14px_38px_rgba(32,68,118,0.2),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl"
        >
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-[var(--accent)]"
          />
          <span>{toastMessage}</span>
        </div>
      )}
    </AppWindowShell>
  );
}
