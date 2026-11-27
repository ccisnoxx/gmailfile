import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  AppWindow,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Mail,
  MailCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppShellContext } from './app-window-shell';
import { IconTooltip } from './icon-tooltip';

export type SidebarSectionKey =
  'all' | 'normal' | 'pending' | 'risk' | 'disabled' | 'archived' | 'trash';

export type SidebarAccountStatusKey =
  'normal' | 'pending' | 'risk' | 'disabled' | 'archived';

export type WorkspaceNavKey =
  | 'dashboard'
  | 'accounts'
  | 'apps'
  | 'recovery'
  | 'tags'
  | 'transfer'
  | 'archived'
  | 'trash'
  | 'audit'
  | 'backup'
  | 'settings';

export type SidebarCounts = {
  all: number;
  normal: number;
  pending?: number;
  risk: number;
  disabled: number;
  archived: number;
  trash: number;
};

export type SidebarTagItem = {
  id: string;
  name: string;
  count?: number;
};

export type SidebarSystemStatus = {
  healthy?: boolean;
  headline?: string;
  httpsEnabled?: boolean;
  csrfEnabled?: boolean;
  encryptionLabel?: string;
  totpEnabled?: boolean;
  lastBackupLabel?: string;
  version?: string;
};

export const ACCOUNTS_EXPANDED_KEY = 'gm_sidebar_accounts_expanded';
export const TAGS_EXPANDED_KEY = 'gm_sidebar_tags_expanded';
export const SIDEBAR_COLLAPSED_KEY = 'gm_sidebar_collapsed_v1';
export const SIDEBAR_LAYOUT_SYNC_EVENT = 'gm:sidebar-layout-sync';

const SUB_STATUS_KEYS = new Set<SidebarSectionKey>([
  'normal',
  'pending',
  'risk',
  'disabled',
  'archived',
]);

function readBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* 隐私模式忽略 */
  }
  return fallback;
}

function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event(SIDEBAR_LAYOUT_SYNC_EVENT));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function readSidebarLayoutState(): {
  collapsed: boolean;
  accountsExpanded: boolean;
} {
  return {
    collapsed: readBoolPref(SIDEBAR_COLLAPSED_KEY, false),
    accountsExpanded: readBoolPref(ACCOUNTS_EXPANDED_KEY, false),
  };
}

const tagIconColors = [
  'text-[#8468f5]',
  'text-[#1677ff]',
  'text-[#2fbf71]',
  'text-[#f5a623]',
] as const;

function tagColorClass(name: string, index: number): string {
  if (name.includes('开发')) return 'text-[#8468f5]';
  if (name.includes('测试')) return 'text-[#1677ff]';
  if (name.includes('工具')) return 'text-[#2fbf71]';
  if (name.includes('长期')) return 'text-[#f5a623]';
  return tagIconColors[index % tagIconColors.length];
}

type AccountsSidebarProps = {
  mode?: 'accounts';
  activeSection: SidebarSectionKey | null;
  activeTagId?: string | null;
  dashboardActive?: boolean;
  appsActive?: boolean;
  recoveryActive?: boolean;
  counts: SidebarCounts;
  tags: SidebarTagItem[];
  systemStatus?: SidebarSystemStatus;
  onSelectSection: (key: SidebarSectionKey) => void;
  onSelectTag: (tagId: string) => void;
  onAddTag: () => void;
  onOpenDashboard?: () => void;
  onOpenApps?: () => void;
  onOpenRecoveryUsage?: () => void;
  onOpenTransfer?: () => void;
  onOpenAudit?: () => void;
  onOpenBackup: () => void;
  onOpenSettings?: () => void;
  className?: string;
};

export type WorkspaceSecondaryNavItem = {
  key: string;
  label: string;
};

export type WorkspaceSecondaryNavConfig = {
  ariaLabel?: string;
  title?: string;
  items: readonly WorkspaceSecondaryNavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
};

type WorkspaceSidebarProps = {
  mode: 'workspace';
  activeNav: WorkspaceNavKey;
  activeSection?: SidebarSectionKey | null;
  activeTagId?: string | null;
  counts?: SidebarCounts;
  tags?: SidebarTagItem[];
  trashCount?: number;
  systemStatus?: SidebarSystemStatus;
  secondaryNav?: WorkspaceSecondaryNavConfig;
  onSelectNav: (key: WorkspaceNavKey) => void;
  onSelectSection?: (key: SidebarSectionKey) => void;
  onSelectTag?: (tagId: string) => void;
  onAddTag?: () => void;
  className?: string;
};

export type PrimarySidebarProps = AccountsSidebarProps | WorkspaceSidebarProps;

type NormalizedSidebarModel = {
  activeNav: WorkspaceNavKey | null;
  activeSection: SidebarSectionKey | null;
  activeTagId: string | null;
  counts?: SidebarCounts;
  trashCount: number;
  tags: SidebarTagItem[];
  showTagSection: boolean;
  systemStatus?: SidebarSystemStatus;
  secondaryNav?: WorkspaceSecondaryNavConfig;
  onSelectDashboard?: () => void;
  onSelectSection: (section: SidebarSectionKey) => void;
  onSelectApps?: () => void;
  onSelectRecovery?: () => void;
  onSelectTag?: (tagId: string) => void;
  onAddTag?: () => void;
  onSelectTransfer?: () => void;
  onSelectAudit?: () => void;
  onSelectBackup?: () => void;
  onSelectSettings?: () => void;
  className?: string;
};

function normalizeProps(props: PrimarySidebarProps): NormalizedSidebarModel {
  if (props.mode === 'workspace') {
    const activeSection: SidebarSectionKey | null =
      props.activeSection !== undefined
        ? props.activeSection
        : props.activeNav === 'accounts'
          ? 'all'
          : props.activeNav === 'archived'
            ? 'archived'
            : props.activeNav === 'trash'
              ? 'trash'
              : null;

    return {
      activeNav: props.activeNav,
      activeSection,
      activeTagId: props.activeTagId ?? null,
      counts: props.counts,
      trashCount: Math.max(props.counts?.trash ?? 0, props.trashCount ?? 0),
      tags: props.tags ?? [],
      showTagSection: true,
      systemStatus: props.systemStatus ?? {},
      secondaryNav: props.secondaryNav,
      onSelectDashboard: () => props.onSelectNav('dashboard'),
      onSelectSection: (section) => {
        if (props.onSelectSection) {
          props.onSelectSection(section);
          return;
        }
        if (section === 'trash') props.onSelectNav('trash');
        else if (section === 'archived') props.onSelectNav('archived');
        else props.onSelectNav('accounts');
      },
      onSelectApps: () => props.onSelectNav('apps'),
      onSelectRecovery: () => props.onSelectNav('recovery'),
      onSelectTag: props.onSelectTag,
      onAddTag: props.onAddTag ?? (() => props.onSelectNav('tags')),
      onSelectTransfer: () => props.onSelectNav('transfer'),
      onSelectAudit: () => props.onSelectNav('audit'),
      onSelectBackup: () => props.onSelectNav('backup'),
      onSelectSettings: () => props.onSelectNav('settings'),
      className: props.className,
    };
  }

  const activeNav: WorkspaceNavKey | null = props.dashboardActive
    ? 'dashboard'
    : props.appsActive
      ? 'apps'
      : props.recoveryActive
        ? 'recovery'
        : props.activeSection === 'trash'
          ? 'trash'
          : 'accounts';

  return {
    activeNav,
    activeSection:
      props.dashboardActive || props.appsActive || props.recoveryActive
        ? null
        : props.activeSection,
    activeTagId: props.activeTagId ?? null,
    counts: props.counts,
    trashCount: props.counts.trash,
    tags: props.tags,
    showTagSection: true,
    systemStatus: props.systemStatus,
    onSelectDashboard: props.onOpenDashboard,
    onSelectSection: props.onSelectSection,
    onSelectApps: props.onOpenApps,
    onSelectRecovery: props.onOpenRecoveryUsage,
    onSelectTag: props.onSelectTag,
    onAddTag: props.onAddTag,
    onSelectTransfer: props.onOpenTransfer,
    onSelectAudit: props.onOpenAudit,
    onSelectBackup: props.onOpenBackup,
    onSelectSettings: props.onOpenSettings,
    className: props.className,
  };
}

export function PrimarySidebar(props: PrimarySidebarProps) {
  const shell = useAppShellContext();
  const model = normalizeProps(props);

  const hasActiveSubStatus = Boolean(
    model.activeSection &&
    SUB_STATUS_KEYS.has(model.activeSection) &&
    !model.activeTagId,
  );

  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readBoolPref(SIDEBAR_COLLAPSED_KEY, false),
  );
  const [accountsExpanded, setAccountsExpanded] = useState<boolean>(() =>
    hasActiveSubStatus ? true : readBoolPref(ACCOUNTS_EXPANDED_KEY, false),
  );
  const [tagsExpanded, setTagsExpanded] = useState<boolean>(() =>
    readBoolPref(TAGS_EXPANDED_KEY, true),
  );

  const effectiveCollapsed = collapsed && !shell?.mobileSidebarOpen;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      writeBoolPref(SIDEBAR_COLLAPSED_KEY, next);
      return next;
    });
  };

  // 当通过筛选或统计卡片选中某个账号子状态时，自动展开「全部账号」以展示当前定位
  useEffect(() => {
    if (hasActiveSubStatus) {
      setAccountsExpanded(true);
    }
  }, [hasActiveSubStatus]);

  const toggleAccountsExpanded = () => {
    setAccountsExpanded((prev) => {
      const next = !prev;
      writeBoolPref(ACCOUNTS_EXPANDED_KEY, next);
      return next;
    });
  };

  const toggleTagsExpanded = () => {
    setTagsExpanded((prev) => {
      const next = !prev;
      writeBoolPref(TAGS_EXPANDED_KEY, next);
      return next;
    });
  };

  const subStatusItems: {
    key: SidebarAccountStatusKey;
    label: string;
    count?: number;
    dotClass: string;
  }[] = [
    {
      key: 'normal',
      label: '正常账号',
      count: model.counts?.normal,
      dotClass: 'bg-[var(--success)]',
    },
    ...(model.counts === undefined || model.counts.pending !== undefined
      ? [
          {
            key: 'pending' as const,
            label: '待验证',
            count: model.counts?.pending,
            dotClass: 'bg-[#e5a229]',
          },
        ]
      : []),
    {
      key: 'risk',
      label: '风险账号',
      count: model.counts?.risk,
      dotClass: 'bg-[var(--danger)]',
    },
    {
      key: 'disabled',
      label: '停用账号',
      count: model.counts?.disabled,
      dotClass: 'bg-[#7c8798]',
    },
    {
      key: 'archived',
      label: '已归档',
      count: model.counts?.archived,
      dotClass: 'bg-[#94a3b8]',
    },
  ];

  const isDashboardActive = model.activeNav === 'dashboard';
  const isAllAccountsActive =
    model.activeSection === 'all' && !model.activeTagId;
  const isAppsActive = model.activeNav === 'apps';
  const isRecoveryActive = model.activeNav === 'recovery';
  const isTrashActive = model.activeSection === 'trash' && !model.activeTagId;

  const navItemClass = (active: boolean) =>
    cn(
      'flex h-[35px] w-full items-center justify-between rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
      active
        ? 'border border-[var(--accent)]/26 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
        : 'font-medium text-[var(--text-primary)]/90 hover:bg-[var(--surface-control-hover)]',
    );

  const iconClass = (active: boolean) =>
    cn(
      'size-4 shrink-0',
      active ? 'text-[var(--accent-text)]' : 'text-[var(--text-secondary)]',
    );

  const countBadgeClass = (active: boolean) =>
    cn(
      'ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums',
      active
        ? 'bg-[var(--surface-control-hover)] text-[var(--accent-text)]'
        : 'bg-[var(--surface-control)] text-[var(--text-secondary)]',
    );

  const healthy = model.systemStatus?.healthy ?? true;
  const headline =
    model.systemStatus?.headline ??
    (healthy ? '系统运行正常' : '备份或服务需排查');

  if (effectiveCollapsed) {
    const railItemClass = (active: boolean) =>
      cn(
        'relative mx-auto inline-flex size-10 items-center justify-center rounded-xl transition-all duration-[180ms] ease-out',
        active
          ? 'border border-[var(--accent)]/28 bg-[var(--accent-soft)] text-[var(--accent-text)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]',
      );

    return (
      <aside
        data-slot="primary-sidebar"
        data-collapsed="true"
        aria-label="侧边导航栏"
        className={cn(
          'macos-nav-surface flex w-full shrink-0 flex-col items-center justify-between gap-3 border-b border-[var(--nav-divider)] px-2 py-3 lg:w-[60px] lg:border-r lg:border-b-0',
          model.className,
        )}
      >
        <nav
          aria-label="核心资产导航"
          className="flex flex-col items-center gap-1.5"
        >
          {model.onSelectDashboard && (
            <IconTooltip label="数据概览">
              <button
                type="button"
                aria-label="数据概览"
                aria-current={isDashboardActive ? 'page' : undefined}
                onClick={model.onSelectDashboard}
                className={railItemClass(isDashboardActive)}
              >
                <BarChart3 className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          <IconTooltip
            label={`全部账号${model.counts !== undefined ? `（${model.counts.all}）` : ''}`}
          >
            <button
              type="button"
              aria-label="全部账号"
              aria-pressed={isAllAccountsActive || hasActiveSubStatus}
              onClick={() => model.onSelectSection('all')}
              className={railItemClass(
                isAllAccountsActive || hasActiveSubStatus,
              )}
            >
              <Mail className="size-4" aria-hidden="true" />
            </button>
          </IconTooltip>
          <IconTooltip
            label={`回收站${model.trashCount > 0 ? `（${model.trashCount}）` : ''}`}
          >
            <button
              type="button"
              aria-label="回收站"
              aria-pressed={isTrashActive}
              onClick={() => model.onSelectSection('trash')}
              className={railItemClass(isTrashActive)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {model.trashCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--accent)]"
                />
              )}
            </button>
          </IconTooltip>
          {model.onSelectApps && (
            <IconTooltip label="已注册应用">
              <button
                type="button"
                aria-label="已注册应用"
                aria-current={isAppsActive ? 'page' : undefined}
                onClick={model.onSelectApps}
                className={railItemClass(isAppsActive)}
              >
                <AppWindow className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          {model.onSelectRecovery && (
            <IconTooltip label="辅助邮箱统计">
              <button
                type="button"
                aria-label="辅助邮箱统计"
                aria-current={isRecoveryActive ? 'page' : undefined}
                onClick={model.onSelectRecovery}
                className={railItemClass(isRecoveryActive)}
              >
                <MailCheck className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          {model.onAddTag && (
            <IconTooltip label="标签管理">
              <button
                type="button"
                aria-label="标签管理"
                onClick={model.onAddTag}
                className={railItemClass(Boolean(model.activeTagId))}
              >
                <TagIcon className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          {model.onSelectTransfer && (
            <IconTooltip label="导入 / 导出（CSV）">
              <button
                type="button"
                aria-label="导入 / 导出（CSV）"
                aria-current={
                  model.activeNav === 'transfer' ? 'page' : undefined
                }
                onClick={model.onSelectTransfer}
                className={railItemClass(model.activeNav === 'transfer')}
              >
                <ArrowUpDown className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          {model.onSelectAudit && (
            <IconTooltip label="审计日志">
              <button
                type="button"
                aria-label="审计日志"
                aria-current={model.activeNav === 'audit' ? 'page' : undefined}
                onClick={model.onSelectAudit}
                className={railItemClass(model.activeNav === 'audit')}
              >
                <FileText className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          {model.onSelectBackup && (
            <IconTooltip label="备份与恢复">
              <button
                type="button"
                aria-label="备份与恢复"
                aria-current={model.activeNav === 'backup' ? 'page' : undefined}
                onClick={model.onSelectBackup}
                className={railItemClass(model.activeNav === 'backup')}
              >
                <Database className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
          {model.onSelectSettings && (
            <IconTooltip label="系统设置">
              <button
                type="button"
                aria-label="系统设置"
                aria-current={
                  model.activeNav === 'settings' ? 'page' : undefined
                }
                onClick={model.onSelectSettings}
                className={railItemClass(model.activeNav === 'settings')}
              >
                <Settings className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
        </nav>

        <div className="flex flex-col items-center gap-2">
          {model.systemStatus && (
            <IconTooltip label={headline}>
              <button
                type="button"
                aria-label={`系统运行状态：${headline}`}
                onClick={model.onSelectBackup ?? model.onSelectSettings}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] transition-colors hover:bg-[var(--surface-control-hover)]"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2.5 rounded-full',
                    healthy ? 'bg-[var(--success)]' : 'bg-[var(--warning)]',
                  )}
                />
              </button>
            </IconTooltip>
          )}
          <IconTooltip label="展开侧边栏">
            <button
              type="button"
              data-slot="sidebar-collapse-toggle"
              aria-label="展开侧边栏"
              onClick={toggleCollapsed}
              className="hidden size-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)] lg:inline-flex"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </IconTooltip>
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-slot="primary-sidebar"
      data-collapsed="false"
      aria-label="侧边导航栏"
      className={cn(
        'macos-nav-surface flex w-full shrink-0 flex-col justify-between gap-4 border-b border-[var(--nav-divider)] px-3 py-3.5 lg:w-[224px] lg:border-r lg:border-b-0',
        model.className,
      )}
    >
      <div className="flex flex-col gap-3.5">
        {/* 1. 概览与账号 */}
        <section aria-label="概览与账号">
          <div className="mb-1.5 flex items-center justify-between px-2.5">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              概览与账号
            </p>
            <IconTooltip label="收起为窄图标栏" align="end">
              <button
                type="button"
                data-slot="sidebar-collapse-toggle"
                aria-label="收起侧边栏"
                onClick={toggleCollapsed}
                className="hidden size-6 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)] lg:inline-flex"
              >
                <PanelLeftClose className="size-3.5" aria-hidden="true" />
              </button>
            </IconTooltip>
          </div>
          <nav aria-label="核心资产导航" className="flex flex-col gap-1">
            {model.onSelectDashboard && (
              <button
                type="button"
                aria-current={isDashboardActive ? 'page' : undefined}
                onClick={model.onSelectDashboard}
                className={navItemClass(isDashboardActive)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <BarChart3
                    className={iconClass(isDashboardActive)}
                    aria-hidden="true"
                  />
                  <span className="truncate">数据概览</span>
                </span>
              </button>
            )}

            {/* 全部账号（点击主项展开/切换，右侧箭头独立折叠/展开子状态） */}
            <div className="flex flex-col gap-0.5">
              <div
                className={cn(
                  'flex h-[35px] w-full items-center rounded-xl transition-all duration-[180ms] ease-out',
                  isAllAccountsActive
                    ? 'border border-[var(--accent)]/26 bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : hasActiveSubStatus
                      ? 'bg-[var(--surface-control)]/70 text-[var(--text-primary)]'
                      : 'text-[var(--text-primary)]/90 hover:bg-[var(--surface-control-hover)]',
                )}
              >
                <button
                  type="button"
                  aria-pressed={isAllAccountsActive}
                  onClick={() => {
                    if (isAllAccountsActive) {
                      toggleAccountsExpanded();
                    } else {
                      setAccountsExpanded(true);
                      writeBoolPref(ACCOUNTS_EXPANDED_KEY, true);
                    }
                    model.onSelectSection('all');
                  }}
                  className={cn(
                    'flex h-full min-w-0 flex-1 items-center justify-between pr-1 pl-2.5 text-[13px]',
                    isAllAccountsActive ? 'font-semibold' : 'font-medium',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Mail
                      className={iconClass(isAllAccountsActive)}
                      aria-hidden="true"
                    />
                    <span className="truncate">全部账号</span>
                  </span>
                  {model.counts !== undefined && (
                    <span className={countBadgeClass(isAllAccountsActive)}>
                      {model.counts.all}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={
                    accountsExpanded ? '收起账号状态分组' : '展开账号状态分组'
                  }
                  aria-expanded={accountsExpanded}
                  onClick={toggleAccountsExpanded}
                  className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
                >
                  {accountsExpanded ? (
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>

              {accountsExpanded && (
                <div
                  role="group"
                  aria-label="账号状态子菜单"
                  className="mt-0.5 ml-3.5 flex flex-col gap-0.5 border-l border-[var(--nav-divider)] pl-2.5"
                >
                  {subStatusItems.map((item) => {
                    const active =
                      model.activeSection === item.key && !model.activeTagId;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => model.onSelectSection(item.key)}
                        className={cn(
                          'flex h-[31px] w-full items-center justify-between rounded-lg px-2 text-[12.5px] transition-all duration-[160ms] ease-out',
                          active
                            ? 'border border-[var(--accent)]/24 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                            : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              item.dotClass,
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.count !== undefined && (
                          <span className={countBadgeClass(active)}>
                            {item.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              aria-pressed={isTrashActive}
              onClick={() => model.onSelectSection('trash')}
              className={navItemClass(isTrashActive)}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Trash2
                  className={iconClass(isTrashActive)}
                  aria-hidden="true"
                />
                <span className="truncate">回收站</span>
              </span>
              {model.trashCount > 0 && (
                <span
                  data-slot="trash-badge"
                  aria-label={`回收站 ${model.trashCount} 项`}
                  className={cn(
                    'ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums',
                    isTrashActive
                      ? 'bg-[var(--accent)] text-[var(--primary-foreground)]'
                      : 'bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]',
                  )}
                >
                  {model.trashCount}
                </span>
              )}
            </button>
          </nav>
        </section>

        {/* 2. 关系：统一归拢已注册应用、辅助邮箱与标签 */}
        {(model.onSelectApps ||
          model.onSelectRecovery ||
          model.showTagSection) && (
          <section
            aria-label="关系"
            className="border-t border-[var(--nav-divider)] pt-3"
          >
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              关系
            </p>
            <nav aria-label="关系导航" className="flex flex-col gap-1">
              {model.onSelectApps && (
                <button
                  type="button"
                  aria-current={isAppsActive ? 'page' : undefined}
                  onClick={model.onSelectApps}
                  className={navItemClass(isAppsActive)}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <AppWindow
                      className={iconClass(isAppsActive)}
                      aria-hidden="true"
                    />
                    <span className="truncate">已注册应用</span>
                  </span>
                </button>
              )}

              {model.onSelectRecovery && (
                <button
                  type="button"
                  aria-current={isRecoveryActive ? 'page' : undefined}
                  onClick={model.onSelectRecovery}
                  className={navItemClass(isRecoveryActive)}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <MailCheck
                      className={iconClass(isRecoveryActive)}
                      aria-hidden="true"
                    />
                    <span className="truncate">辅助邮箱统计</span>
                  </span>
                </button>
              )}
            </nav>

            {model.showTagSection && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between px-1.5">
                  <button
                    type="button"
                    aria-expanded={tagsExpanded}
                    onClick={toggleTagsExpanded}
                    className="inline-flex min-h-6 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    {tagsExpanded ? (
                      <ChevronDown className="size-3" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-3" aria-hidden="true" />
                    )}
                    <span>标签</span>
                  </button>
                  {model.onAddTag && (
                    <IconTooltip label="管理 / 新增标签" align="end">
                      <button
                        type="button"
                        aria-label="新增标签"
                        onClick={model.onAddTag}
                        className="inline-flex size-6 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                      </button>
                    </IconTooltip>
                  )}
                </div>
                {tagsExpanded && (
                  <div className="flex flex-col gap-0.5">
                    {model.tags.length > 0 && model.onSelectTag ? (
                      model.tags.map((tag, idx) => {
                        const active = model.activeTagId === tag.id;
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => model.onSelectTag?.(tag.id)}
                            className={cn(
                              'flex h-[32px] w-full items-center justify-between rounded-xl px-2.5 text-[12.5px] transition-all duration-[160ms] ease-out',
                              active
                                ? 'border border-[var(--accent)]/24 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                                : 'font-medium text-[var(--text-primary)]/90 hover:bg-[var(--surface-control-hover)]',
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <TagIcon
                                className={cn(
                                  'size-3.5 shrink-0',
                                  tagColorClass(tag.name, idx),
                                )}
                                aria-hidden="true"
                              />
                              <span className="truncate">{tag.name}</span>
                            </span>
                            {tag.count !== undefined && (
                              <span className={countBadgeClass(active)}>
                                {tag.count}
                              </span>
                            )}
                          </button>
                        );
                      })
                    ) : model.onAddTag ? (
                      <button
                        type="button"
                        onClick={model.onAddTag}
                        className={navItemClass(model.activeNav === 'tags')}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <TagIcon
                            className={iconClass(model.activeNav === 'tags')}
                            aria-hidden="true"
                          />
                          <span className="truncate">标签管理</span>
                        </span>
                      </button>
                    ) : (
                      <p className="px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                        暂无标签
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* 3. 数据操作：导入导出、审计、备份 */}
        {(model.onSelectTransfer ||
          model.onSelectAudit ||
          model.onSelectBackup) && (
          <section
            aria-label="数据操作"
            className="border-t border-[var(--nav-divider)] pt-3"
          >
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              数据操作
            </p>
            <nav aria-label="数据操作导航" className="flex flex-col gap-1">
              {model.onSelectTransfer && (
                <button
                  type="button"
                  aria-current={
                    model.activeNav === 'transfer' ? 'page' : undefined
                  }
                  onClick={model.onSelectTransfer}
                  className={navItemClass(model.activeNav === 'transfer')}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ArrowUpDown
                      className={iconClass(model.activeNav === 'transfer')}
                      aria-hidden="true"
                    />
                    <span className="truncate">导入 / 导出（CSV）</span>
                  </span>
                </button>
              )}
              {model.onSelectAudit && (
                <button
                  type="button"
                  aria-current={
                    model.activeNav === 'audit' ? 'page' : undefined
                  }
                  onClick={model.onSelectAudit}
                  className={navItemClass(model.activeNav === 'audit')}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FileText
                      className={iconClass(model.activeNav === 'audit')}
                      aria-hidden="true"
                    />
                    <span className="truncate">审计日志</span>
                  </span>
                </button>
              )}
              {model.onSelectBackup && (
                <button
                  type="button"
                  aria-current={
                    model.activeNav === 'backup' ? 'page' : undefined
                  }
                  onClick={model.onSelectBackup}
                  className={navItemClass(model.activeNav === 'backup')}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Database
                      className={iconClass(model.activeNav === 'backup')}
                      aria-hidden="true"
                    />
                    <span className="truncate">备份与恢复</span>
                  </span>
                </button>
              )}
            </nav>
          </section>
        )}

        {/* 4. 系统设置 */}
        {model.onSelectSettings && (
          <section
            aria-label="设置"
            className="border-t border-[var(--nav-divider)] pt-3"
          >
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              设置
            </p>
            <nav aria-label="系统设置导航" className="flex flex-col gap-1">
              <button
                type="button"
                aria-current={
                  model.activeNav === 'settings' ? 'page' : undefined
                }
                onClick={model.onSelectSettings}
                className={navItemClass(model.activeNav === 'settings')}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Settings
                    className={iconClass(model.activeNav === 'settings')}
                    aria-hidden="true"
                  />
                  <span className="truncate">系统设置</span>
                </span>
              </button>
            </nav>
          </section>
        )}

        {/* 可选二级分组导航 */}
        {model.secondaryNav && model.secondaryNav.items.length > 0 && (
          <section
            aria-label={model.secondaryNav.title ?? '分组导航'}
            className="border-t border-[var(--nav-divider)] pt-3"
          >
            {model.secondaryNav.title && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
                {model.secondaryNav.title}
              </p>
            )}
            <nav
              aria-label={model.secondaryNav.ariaLabel ?? '二级导航'}
              className="flex flex-col gap-1"
            >
              {model.secondaryNav.items.map((item) => {
                const subActive = model.secondaryNav?.activeKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={subActive ? 'location' : undefined}
                    onClick={() => model.secondaryNav?.onSelect(item.key)}
                    className={cn(
                      'flex h-[32px] w-full items-center gap-2 rounded-full px-3 text-[12.5px] transition-all duration-[180ms] ease-out',
                      subActive
                        ? 'border border-[var(--accent)]/26 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                        : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full transition-colors',
                        subActive
                          ? 'bg-[var(--accent)]'
                          : 'bg-[var(--text-secondary)]/50',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </section>
        )}
      </div>

      {/* 底部：精简系统运行状态条 */}
      {model.systemStatus && (
        <div className="space-y-1.5 pt-2">
          <button
            type="button"
            data-slot="system-status-card"
            onClick={model.onSelectBackup ?? model.onSelectSettings}
            className="w-full rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-2.5 text-left transition-colors hover:bg-[var(--surface-control-hover)]"
          >
            <span className="sr-only">系统运行状态：</span>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    healthy
                      ? 'bg-[var(--success)] shadow-[0_0_0_3px_rgba(47,191,113,0.18)]'
                      : 'bg-[var(--warning)] shadow-[0_0_0_3px_rgba(245,166,35,0.18)]',
                  )}
                />
                <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                  {headline}
                </span>
              </span>
              {healthy ? (
                <CheckCircle2
                  className="size-3.5 shrink-0 text-[var(--success)]"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle
                  className="size-3.5 shrink-0 text-[var(--warning)]"
                  aria-hidden="true"
                />
              )}
            </div>
            {(model.systemStatus.lastBackupLabel ||
              model.systemStatus.version) && (
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                <span
                  data-dynamic="timestamp"
                  className="truncate"
                  title={model.systemStatus.lastBackupLabel}
                >
                  {model.systemStatus.lastBackupLabel
                    ? `备份：${model.systemStatus.lastBackupLabel}`
                    : 'AES-256-GCM'}
                </span>
                {model.systemStatus.version && (
                  <span className="shrink-0 tabular-nums opacity-85">
                    {model.systemStatus.version}
                  </span>
                )}
              </div>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
