import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowUpDown,
  Bell,
  ChevronDown,
  Database,
  FileText,
  Home,
  Layers,
  LogOut,
  Mail,
  Search,
  Settings,
  ShieldCheck,
  Tag as TagIcon,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  AppWindowShell,
  GmailMark,
  MacMenuBar,
  MacTrafficLights,
  NavigationOpacitySlider,
  type DisplaySettingsState,
} from '@/components/macos';
import { cn } from '@/lib/utils';
import type { SidebarCounts, TransferSubTab } from './types';

export type TransferTopNavKey =
  'dashboard' | 'accounts' | 'tags' | 'transfer' | 'batch';

export type TransferSidebarKey =
  | 'accounts'
  | 'tags'
  | 'archived'
  | 'trash'
  | 'transfer'
  | 'batch'
  | 'audit'
  | 'backup'
  | 'settings';

const TOP_NAV_ITEMS: readonly {
  key: TransferTopNavKey;
  label: string;
  icon: typeof Mail;
}[] = [
  { key: 'dashboard', label: '控制台', icon: Home },
  { key: 'accounts', label: 'Gmail 账号', icon: Mail },
  { key: 'tags', label: '标签管理', icon: TagIcon },
  { key: 'transfer', label: '导入 / 导出', icon: ArrowUpDown },
  { key: 'batch', label: '批量操作', icon: Layers },
];

export function CsvWorkspaceShell({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  activeSubTab,
  sidebarCounts,
  globalSearch,
  onGlobalSearchChange,
  notifications = [],
  onSelectTopNav,
  onSelectSidebarNav,
  onOpenSecurity,
  onOpenAuditLog,
  onLogout,
  children,
}: {
  navAlpha: number;
  onNavAlphaChange: (next: number) => void;
  displaySettings: DisplaySettingsState;
  activeSubTab: TransferSubTab;
  sidebarCounts: SidebarCounts;
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  notifications?: readonly string[];
  onSelectTopNav: (key: TransferTopNavKey) => void;
  onSelectSidebarNav: (key: TransferSidebarKey) => void;
  onOpenSecurity: () => void;
  onOpenAuditLog: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const adminRef = useRef<HTMLDivElement>(null);

  const activeTopNav: TransferTopNavKey =
    activeSubTab === 'batch' ? 'batch' : 'transfer';
  const activeSidebar: TransferSidebarKey =
    activeSubTab === 'batch' ? 'batch' : 'transfer';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!notifOpen && !adminOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (adminRef.current && !adminRef.current.contains(target)) {
        setAdminOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotifOpen(false);
        setAdminOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [adminOpen, notifOpen]);

  const toolbar = (
    <header
      data-slot="transfer-app-toolbar"
      className="macos-nav-surface relative z-30 flex min-h-[68px] flex-wrap items-center justify-between gap-3 border-b border-[var(--nav-divider)] px-4 py-2.5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.65)] sm:px-5"
    >
      {/* 左侧：交通灯 + 项目图标与名称 */}
      <div className="flex shrink-0 items-center gap-3.5">
        <MacTrafficLights />
        <div className="flex items-center gap-2.5">
          <GmailMark size="md" />
          <div className="leading-tight">
            <p className="text-[14.5px] font-semibold tracking-tight text-[var(--text-primary)]">
              Gmail 账号管理系统
            </p>
            <p className="text-[11px] text-[#475467]">
              私有部署 · 单管理员模式
            </p>
          </div>
        </div>
      </div>

      {/* 中间：主导航 */}
      <nav
        aria-label="应用主导航"
        className="flex flex-wrap items-center gap-1 rounded-2xl border border-white/65 bg-white/32 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
      >
        {TOP_NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const active = activeTopNav === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTopNav(key)}
              className={cn(
                'inline-flex h-8.5 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium transition-all duration-[180ms] ease-out',
                active
                  ? 'border border-white/45 bg-[linear-gradient(180deg,rgba(18,104,226,0.96),rgba(13,86,196,0.98))] text-white shadow-[0_6px_16px_rgba(22,119,255,0.26),inset_0_1px_0_rgba(255,255,255,0.34)]'
                  : 'text-[var(--text-primary)]/90 hover:-translate-y-[0.5px] hover:bg-white/62 hover:text-[var(--text-primary)]',
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 右侧：全局搜索 + 通知 + 管理员头像 */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative flex w-44 items-center sm:w-52">
          <Search
            className="pointer-events-none absolute left-3 size-3.5 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            aria-label="全局搜索"
            placeholder="全局搜索（⌘K）"
            value={globalSearch}
            onChange={(e) => onGlobalSearchChange(e.target.value)}
            maxLength={120}
            className="h-8.5 w-full rounded-full border border-white/82 bg-white/58 pr-7 pl-8.5 text-[12.5px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] backdrop-blur-md transition-colors placeholder:text-[var(--text-secondary)] focus:bg-white/88 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
          {globalSearch && (
            <button
              type="button"
              aria-label="清空全局搜索"
              onClick={() => onGlobalSearchChange('')}
              className="absolute right-2 inline-flex size-4.5 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-white/80 hover:text-[var(--text-primary)]"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* 通知 */}
        <div ref={notifRef} className="relative">
          <button
            type="button"
            aria-label="通知"
            aria-expanded={notifOpen}
            onClick={() => {
              setNotifOpen((prev) => !prev);
              setAdminOpen(false);
            }}
            className="relative inline-flex size-8.5 items-center justify-center rounded-full border border-white/75 bg-white/58 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] transition-all hover:bg-white/85"
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
              className="macos-glass-modal absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl p-3 text-xs text-[var(--text-primary)]"
            >
              <p className="mb-2 text-[13px] font-semibold">最近通知</p>
              {notifications.length > 0 ? (
                <ul className="space-y-1.5">
                  {notifications.map((msg, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl bg-white/62 px-2.5 py-2 leading-5"
                    >
                      {msg}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-white/55 px-2.5 py-2 text-[var(--text-secondary)]">
                  CSV 校验服务与防篡改审计链均运行正常。
                </p>
              )}
            </div>
          )}
        </div>

        {/* 管理员头像 */}
        <div ref={adminRef} className="relative">
          <button
            type="button"
            aria-label="管理员菜单"
            aria-expanded={adminOpen}
            onClick={() => {
              setAdminOpen((prev) => !prev);
              setNotifOpen(false);
            }}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-white/75 bg-white/58 pr-2.5 pl-1.5 text-[12.5px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] transition-all hover:bg-white/85"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              <User className="size-3.5" />
            </span>
            <span className="hidden sm:inline">管理员</span>
            <ChevronDown
              className="size-3.5 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
          </button>

          {adminOpen && (
            <div
              role="menu"
              aria-label="管理员操作菜单"
              className="macos-glass-modal absolute right-0 z-50 mt-2 w-48 rounded-2xl p-1.5 text-[12.5px] text-[var(--text-primary)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdminOpen(false);
                  onOpenSecurity();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
              >
                <ShieldCheck className="size-4 text-[var(--accent)]" />
                <span>安全与设置</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdminOpen(false);
                  onOpenAuditLog();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--accent-soft)]"
              >
                <FileText className="size-4 text-[var(--text-secondary)]" />
                <span>审计日志</span>
              </button>
              <div className="my-1 h-px bg-[var(--table-divider)]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdminOpen(false);
                  onLogout();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[#b93838] transition-colors hover:bg-[var(--danger-soft)]"
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

  const accountItems: readonly {
    key: TransferSidebarKey;
    label: string;
    count: number;
    icon: typeof Mail;
  }[] = [
    {
      key: 'accounts',
      label: 'Gmail 账号',
      count: sidebarCounts.accounts,
      icon: Mail,
    },
    {
      key: 'tags',
      label: '标签管理',
      count: sidebarCounts.tags,
      icon: TagIcon,
    },
    {
      key: 'archived',
      label: '归档账号',
      count: sidebarCounts.archived,
      icon: Archive,
    },
    {
      key: 'trash',
      label: '回收站',
      count: sidebarCounts.trash,
      icon: Trash2,
    },
  ];

  const dataItems: readonly {
    key: TransferSidebarKey;
    label: string;
    icon: typeof ArrowUpDown;
  }[] = [
    { key: 'transfer', label: '导入 / 导出（CSV）', icon: ArrowUpDown },
    { key: 'batch', label: '批量操作', icon: Layers },
  ];

  const opsItems: readonly {
    key: TransferSidebarKey;
    label: string;
    icon: typeof FileText;
  }[] = [
    { key: 'audit', label: '审计日志', icon: FileText },
    { key: 'backup', label: '备份与恢复', icon: Database },
    { key: 'settings', label: '系统设置', icon: Settings },
  ];

  const renderSidebarButton = ({
    itemKey,
    label,
    icon: Icon,
    count,
  }: {
    itemKey: TransferSidebarKey;
    label: string;
    icon: typeof Mail;
    count?: number;
  }) => {
    const active = activeSidebar === itemKey;
    return (
      <button
        key={itemKey}
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelectSidebarNav(itemKey)}
        className={cn(
          'flex h-[35px] w-full items-center justify-between rounded-xl px-2.5 text-[12.5px] transition-all duration-[180ms] ease-out',
          active
            ? 'border border-[#1677ff]/22 bg-[#1677ff]/14 font-semibold text-[#1158c7] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]'
            : 'font-medium text-[var(--text-primary)]/90 hover:bg-white/55',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            className={cn(
              'size-4 shrink-0',
              active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]',
            )}
            aria-hidden="true"
          />
          <span className="truncate">{label}</span>
        </span>
        {count !== undefined && (
          <span
            className={cn(
              'ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
              active
                ? 'bg-white/82 text-[#1158c7]'
                : 'bg-white/70 text-[#475467]',
            )}
          >
            {count.toLocaleString('en-US')}
          </span>
        )}
      </button>
    );
  };

  const sidebar = (
    <aside
      data-slot="transfer-sidebar"
      aria-label="左侧导航"
      className="macos-nav-surface flex w-full shrink-0 flex-col justify-between gap-4 border-b border-[var(--nav-divider)] px-3.5 py-4 lg:w-[224px] lg:border-r lg:border-b-0"
    >
      <nav aria-label="侧边分组导航" className="flex flex-col gap-4">
        {/* 分组 1：账号管理 */}
        <section aria-label="账号管理">
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[#475467]">
            账号管理
          </p>
          <div className="flex flex-col gap-1">
            {accountItems.map((item) =>
              renderSidebarButton({
                itemKey: item.key,
                label: item.label,
                icon: item.icon,
                count: item.count,
              }),
            )}
          </div>
        </section>

        {/* 分组 2：数据处理 */}
        <section
          aria-label="数据处理"
          className="border-t border-[var(--nav-divider)] pt-3.5"
        >
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[#475467]">
            数据处理
          </p>
          <div className="flex flex-col gap-1">
            {dataItems.map((item) =>
              renderSidebarButton({
                itemKey: item.key,
                label: item.label,
                icon: item.icon,
              }),
            )}
          </div>
        </section>

        {/* 分组 3：审计与运维 */}
        <section
          aria-label="审计与运维"
          className="border-t border-[var(--nav-divider)] pt-3.5"
        >
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[#475467]">
            审计与运维
          </p>
          <div className="flex flex-col gap-1">
            {opsItems.map((item) =>
              renderSidebarButton({
                itemKey: item.key,
                label: item.label,
                icon: item.icon,
              }),
            )}
          </div>
        </section>
      </nav>

      {/* 底部：系统状态 + 版本 v1.2.0 + 界面透明度滑块 */}
      <div className="space-y-2.5 pt-2">
        <div
          data-slot="sidebar-runtime-status"
          className="rounded-2xl border border-white/80 bg-white/68 px-3 py-2.5 shadow-[0_6px_18px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-[var(--success)] shadow-[0_0_0_3px_rgba(47,191,113,0.18)]"
              />
              系统运行正常
            </span>
          </div>
          <p className="mt-1 pl-4 text-[11px] tabular-nums text-[#475467]">
            版本 v1.2.0
          </p>
        </div>

        <NavigationOpacitySlider
          variant="sidebar"
          label="界面透明度"
          value={navAlpha}
          onChange={onNavAlphaChange}
          className="bg-white/68"
        />
      </div>
    </aside>
  );

  return (
    <AppWindowShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      menuBar={<MacMenuBar appName="Gmail 账号管理" statusLabel="系统正常" />}
      toolbar={toolbar}
      sidebar={sidebar}
      mainClassName="flex-col gap-4 p-4 sm:p-5 lg:p-5"
    >
      {children}
    </AppWindowShell>
  );
}
