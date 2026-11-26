import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  CheckCircle2,
  Database,
  FileText,
  Home,
  Mail,
  Plus,
  Settings,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconTooltip } from './icon-tooltip';

export type SidebarSectionKey =
  | 'all'
  | 'normal'
  | 'pending'
  | 'risk'
  | 'disabled'
  | 'archived'
  | 'trash';

export type WorkspaceNavKey =
  | 'dashboard'
  | 'accounts'
  | 'tags'
  | 'transfer'
  | 'archived'
  | 'trash'
  | 'audit'
  | 'backup'
  | 'settings';

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
  counts: {
    all: number;
    normal: number;
    pending?: number;
    risk: number;
    disabled: number;
    archived: number;
    trash: number;
  };
  tags: SidebarTagItem[];
  onSelectSection: (key: SidebarSectionKey) => void;
  onSelectTag: (tagId: string) => void;
  onAddTag: () => void;
  onOpenRecoveryUsage?: () => void;
  recoveryActive?: boolean;
  onOpenAudit?: () => void;
  onOpenBackup: () => void;
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
  trashCount?: number;
  systemStatus?: SidebarSystemStatus;
  secondaryNav?: WorkspaceSecondaryNavConfig;
  onSelectNav: (key: WorkspaceNavKey) => void;
  className?: string;
};

export type PrimarySidebarProps = AccountsSidebarProps | WorkspaceSidebarProps;

const workspaceNavItems: readonly {
  key: WorkspaceNavKey;
  label: string;
  icon: typeof Mail;
}[] = [
  { key: 'dashboard', label: '数据概览', icon: Home },
  { key: 'accounts', label: 'Gmail 账号', icon: Mail },
  { key: 'tags', label: '标签管理', icon: TagIcon },
  { key: 'transfer', label: '导入 / 导出（CSV）', icon: ArrowUpDown },
  { key: 'archived', label: '归档账号', icon: Archive },
  { key: 'trash', label: '回收站', icon: Trash2 },
  { key: 'audit', label: '审计日志', icon: FileText },
  { key: 'backup', label: '备份与恢复', icon: Database },
  { key: 'settings', label: '系统设置', icon: Settings },
];

function WorkspacePrimarySidebar({
  activeNav,
  trashCount = 0,
  systemStatus,
  secondaryNav,
  onSelectNav,
  className,
}: WorkspaceSidebarProps) {
  const isHttps =
    systemStatus?.httpsEnabled ??
    (typeof window !== 'undefined' && window.location.protocol === 'https:');
  const healthy = systemStatus?.healthy ?? true;
  const headline =
    systemStatus?.headline ?? (healthy ? '系统运行正常' : '备份或服务需排查');

  const healthItems: { text: string; ok: boolean; isTimestamp?: boolean }[] = [
    {
      text: isHttps ? 'HTTPS 已启用' : '当前为本地 HTTP',
      ok: isHttps,
    },
    {
      text:
        (systemStatus?.csrfEnabled ?? true)
          ? '会话与 CSRF 防护'
          : '会话防护待检查',
      ok: systemStatus?.csrfEnabled ?? true,
    },
    {
      text: systemStatus?.encryptionLabel ?? '字段加密 AES-256-GCM',
      ok: true,
    },
  ];
  if (typeof systemStatus?.totpEnabled === 'boolean') {
    healthItems.push({
      text: systemStatus.totpEnabled ? 'TOTP 双因素认证已启用' : 'TOTP 未启用',
      ok: systemStatus.totpEnabled,
    });
  }
  if (systemStatus?.lastBackupLabel) {
    healthItems.push({
      text: `最近备份：${systemStatus.lastBackupLabel}`,
      ok: healthy,
      isTimestamp: true,
    });
  }

  return (
    <aside
      data-slot="primary-sidebar"
      aria-label="侧边导航栏"
      className={cn(
        'macos-nav-surface flex w-full shrink-0 flex-col justify-between gap-4 border-b border-[var(--nav-divider)] px-3.5 py-4 lg:w-[212px] lg:border-r lg:border-b-0',
        className,
      )}
    >
      <div className="flex flex-col gap-4">
        {/* 主导航入口 */}
        <nav aria-label="系统主导航" className="flex flex-col gap-1">
          {workspaceNavItems.map(({ key, label, icon: Icon }) => {
            const active = activeNav === key;
            return (
              <div key={key} className="flex flex-col">
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelectNav(key)}
                  className={cn(
                    'flex h-[36px] w-full items-center justify-between rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
                    active
                      ? 'border border-[var(--accent)]/26 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                      : 'font-medium text-[var(--text-primary)]/92 hover:bg-[var(--surface-control-hover)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active
                          ? 'text-[var(--accent-text)]'
                          : 'text-[var(--text-secondary)]',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{label}</span>
                  </span>
                  {key === 'trash' && trashCount > 0 && (
                    <span
                      data-slot="trash-badge"
                      aria-label={`回收站 ${trashCount} 项`}
                      className={cn(
                        'ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums',
                        active
                          ? 'bg-[var(--accent)] text-[var(--primary-foreground)]'
                          : 'bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]',
                      )}
                    >
                      {trashCount}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </nav>

        {/* 可选二级分组导航（仅当调用方显式需要时展示） */}
        {secondaryNav && secondaryNav.items.length > 0 && (
          <section
            aria-label={secondaryNav.title ?? '分组导航'}
            className="border-t border-[var(--nav-divider)] pt-3"
          >
            {secondaryNav.title && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
                {secondaryNav.title}
              </p>
            )}
            <nav
              aria-label={secondaryNav.ariaLabel ?? '二级导航'}
              className="flex flex-col gap-1"
            >
              {secondaryNav.items.map((item) => {
                const subActive = secondaryNav.activeKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={subActive ? 'location' : undefined}
                    onClick={() => secondaryNav.onSelect(item.key)}
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

      {/* 底部：真实系统运行状态卡片 */}
      <div className="space-y-2">
        <section
          data-slot="system-status-card"
          aria-label="系统运行状态"
          className="rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-3"
        >
          <div className="flex items-center gap-2 border-b border-[var(--table-divider)] pb-2">
            <span
              aria-hidden="true"
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                healthy
                  ? 'bg-[var(--success)] shadow-[0_0_0_3px_rgba(47,191,113,0.18)]'
                  : 'bg-[var(--warning)] shadow-[0_0_0_3px_rgba(245,166,35,0.18)]',
              )}
            />
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">
              {headline}
            </span>
          </div>
          <ul className="mt-2.5 space-y-1.5 text-[11px] leading-4 text-[var(--text-secondary)]">
            {healthItems.map((item) => (
              <li
                key={item.text}
                data-dynamic={item.isTimestamp ? 'timestamp' : undefined}
                className="flex items-center gap-1.5"
              >
                {item.ok ? (
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
                <span className="truncate">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
        {systemStatus?.version && (
          <p className="text-center text-[11px] tabular-nums text-[var(--text-secondary)]/85">
            {systemStatus.version}
          </p>
        )}
      </div>
    </aside>
  );
}

export function PrimarySidebar(props: PrimarySidebarProps) {
  if (props.mode === 'workspace') {
    return <WorkspacePrimarySidebar {...props} />;
  }

  const {
    activeSection,
    activeTagId,
    counts,
    tags,
    onSelectSection,
    onSelectTag,
    onAddTag,
    onOpenRecoveryUsage,
    recoveryActive = false,
    onOpenAudit,
    onOpenBackup,
    className,
  } = props;

  const sections: {
    key: SidebarSectionKey;
    label: string;
    count: number;
    indicator:
      | 'mail'
      | 'green-dot'
      | 'amber-dot'
      | 'orange-dot'
      | 'gray-dot'
      | 'archive'
      | 'trash';
  }[] = [
    { key: 'all', label: '全部账号', count: counts.all, indicator: 'mail' },
    {
      key: 'normal',
      label: '正常账号',
      count: counts.normal,
      indicator: 'green-dot',
    },
    ...(counts.pending !== undefined
      ? [
          {
            key: 'pending' as const,
            label: '待验证',
            count: counts.pending,
            indicator: 'amber-dot' as const,
          },
        ]
      : []),
    {
      key: 'risk',
      label: '风险账号',
      count: counts.risk,
      indicator: 'orange-dot',
    },
    {
      key: 'disabled',
      label: '停用账号',
      count: counts.disabled,
      indicator: 'gray-dot',
    },
    {
      key: 'archived',
      label: '已归档',
      count: counts.archived,
      indicator: 'archive',
    },
    {
      key: 'trash',
      label: '回收站',
      count: counts.trash,
      indicator: 'trash',
    },
  ];

  const renderIndicator = (
    kind: (typeof sections)[number]['indicator'],
    active: boolean,
  ) => {
    switch (kind) {
      case 'mail':
        return (
          <Mail
            className={cn(
              'size-4 shrink-0',
              active
                ? 'text-[var(--accent-text)]'
                : 'text-[var(--text-secondary)]',
            )}
            aria-hidden="true"
          />
        );
      case 'green-dot':
        return (
          <span
            aria-hidden="true"
            className="mx-1 size-2 shrink-0 rounded-full bg-[var(--success)]"
          />
        );
      case 'amber-dot':
        return (
          <span
            aria-hidden="true"
            className="mx-1 size-2 shrink-0 rounded-full bg-[#e5a229]"
          />
        );
      case 'orange-dot':
        return (
          <span
            aria-hidden="true"
            className="mx-1 size-2 shrink-0 rounded-full bg-[var(--danger)]"
          />
        );
      case 'gray-dot':
        return (
          <span
            aria-hidden="true"
            className="mx-1 size-2 shrink-0 rounded-full bg-[#7c8798]"
          />
        );
      case 'archive':
        return (
          <Archive
            className={cn(
              'size-4 shrink-0',
              active
                ? 'text-[var(--accent-text)]'
                : 'text-[var(--text-secondary)]',
            )}
            aria-hidden="true"
          />
        );
      case 'trash':
        return (
          <Trash2
            className={cn(
              'size-4 shrink-0',
              active
                ? 'text-[var(--accent-text)]'
                : 'text-[var(--text-secondary)]',
            )}
            aria-hidden="true"
          />
        );
    }
  };

  return (
    <aside
      data-slot="primary-sidebar"
      aria-label="侧边导航栏"
      className={cn(
        'macos-nav-surface flex w-full shrink-0 flex-col gap-5 border-b border-[var(--nav-divider)] p-3.5 lg:w-[212px] lg:border-r lg:border-b-0',
        className,
      )}
    >
      {/* 分区 1：账号分类 */}
      <section aria-label="账号分类">
        <p className="mb-2 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
          账号分类
        </p>
        <div className="flex flex-col gap-1">
          {sections.map((item) => {
            const active = activeSection === item.key && !activeTagId;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectSection(item.key)}
                className={cn(
                  'flex h-[36px] w-full items-center justify-between rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
                  active
                    ? 'border border-[var(--accent)]/24 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                    : 'font-medium text-[var(--text-primary)]/90 hover:bg-[var(--surface-control-hover)]',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  {renderIndicator(item.indicator, active)}
                  <span className="truncate">{item.label}</span>
                </span>
                <span
                  className={cn(
                    'ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                    active
                      ? 'bg-[var(--surface-control-hover)] text-[var(--accent-text)]'
                      : 'bg-[var(--surface-control)] text-[var(--text-secondary)]',
                  )}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 分区 2：标签 */}
      <section
        aria-label="标签筛选"
        className="border-t border-[var(--nav-divider)] pt-4"
      >
        <div className="mb-2 flex items-center justify-between px-2.5">
          <p className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
            标签
          </p>
          <IconTooltip label="新增标签" align="end">
            <button
              type="button"
              aria-label="新增标签"
              onClick={onAddTag}
              className="inline-flex size-6 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          </IconTooltip>
        </div>
        <div className="flex flex-col gap-1">
          {tags.length > 0 ? (
            tags.map((tag, idx) => {
              const active = activeTagId === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectTag(tag.id)}
                  className={cn(
                    'flex h-[34px] w-full items-center justify-between rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
                    active
                      ? 'border border-[var(--accent)]/24 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                      : 'font-medium text-[var(--text-primary)]/90 hover:bg-[var(--surface-control-hover)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
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
                    <span className="ml-2 rounded-full bg-[var(--surface-control)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                      {tag.count}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
              暂无标签，点击右上角 + 创建
            </p>
          )}
        </div>
      </section>

      {/* 分区 3：运维入口 */}
      <section
        aria-label="运维入口"
        className="border-t border-[var(--nav-divider)] pt-4"
      >
        <div className="flex flex-col gap-1">
          {onOpenRecoveryUsage && (
            <button
              type="button"
              aria-current={recoveryActive ? 'page' : undefined}
              onClick={onOpenRecoveryUsage}
              className={cn(
                'flex h-[36px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
                recoveryActive
                  ? 'border border-[var(--accent)]/24 bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                  : 'font-medium text-[var(--text-primary)]/90 hover:bg-[var(--surface-control-hover)]',
              )}
            >
              <Mail
                className={cn(
                  'size-4 shrink-0',
                  recoveryActive
                    ? 'text-[var(--accent-text)]'
                    : 'text-[var(--text-secondary)]',
                )}
                aria-hidden="true"
              />
              <span>辅助邮箱统计</span>
            </button>
          )}
          {onOpenAudit && (
            <button
              type="button"
              onClick={onOpenAudit}
              className="flex h-[36px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-[var(--text-primary)]/90 transition-all duration-[180ms] ease-out hover:bg-[var(--surface-control-hover)]"
            >
              <FileText
                className="size-4 shrink-0 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>审计日志</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenBackup}
            className="flex h-[36px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-[var(--text-primary)]/90 transition-all duration-[180ms] ease-out hover:bg-[var(--surface-control-hover)]"
          >
            <Database
              className="size-4 shrink-0 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <span>备份与恢复</span>
          </button>
        </div>
      </section>
    </aside>
  );
}
