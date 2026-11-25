import {
  Archive,
  ArrowUpDown,
  CheckCircle2,
  Cloud,
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
import { GmailMark } from './gmail-mark';

export type SidebarSectionKey =
  'all' | 'normal' | 'risk' | 'disabled' | 'archived' | 'trash';

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
    risk: number;
    disabled: number;
    archived: number;
    trash: number;
  };
  tags: SidebarTagItem[];
  storageUsedLabel?: string;
  storagePercent?: number;
  onSelectSection: (key: SidebarSectionKey) => void;
  onSelectTag: (tagId: string) => void;
  onAddTag: () => void;
  onOpenAudit: () => void;
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
  { key: 'dashboard', label: '控制台', icon: Home },
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
  trashCount = 3,
  systemStatus,
  secondaryNav,
  onSelectNav,
  className,
}: WorkspaceSidebarProps) {
  const status: Required<SidebarSystemStatus> = {
    healthy: systemStatus?.healthy ?? true,
    headline: systemStatus?.headline ?? '系统运行正常',
    httpsEnabled: systemStatus?.httpsEnabled ?? true,
    csrfEnabled: systemStatus?.csrfEnabled ?? true,
    encryptionLabel: systemStatus?.encryptionLabel ?? '字段加密 AES-256-GCM',
    totpEnabled: systemStatus?.totpEnabled ?? true,
    lastBackupLabel: systemStatus?.lastBackupLabel ?? '2026-01-15 02:30',
    version: systemStatus?.version ?? 'v1.1.0',
  };

  const healthItems = [
    status.httpsEnabled ? 'HTTPS / HSTS 已启用' : 'HTTPS 待配置',
    status.csrfEnabled ? '会话与 CSRF 防护' : '会话防护待检查',
    status.encryptionLabel,
    status.totpEnabled ? 'TOTP 双因素认证' : 'TOTP 未开启',
    `最近备份：${status.lastBackupLabel}`,
  ];

  return (
    <aside
      data-slot="primary-sidebar"
      aria-label="主导航"
      className={cn(
        'macos-nav-surface flex w-full shrink-0 flex-col justify-between gap-4 border-b border-[var(--nav-divider)] px-3.5 py-4 lg:w-[210px] lg:border-r lg:border-b-0',
        className,
      )}
    >
      <div className="flex flex-col gap-4">
        {/* 左侧顶部品牌标识 */}
        <div className="flex items-center gap-2 px-0.5 pt-0.5">
          <GmailMark size="md" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13.5px] font-semibold tracking-tight text-[var(--text-primary)]">
              Gmail 账号管理系统
            </p>
            <p className="mt-0.5 text-[10px] tracking-tight whitespace-nowrap text-[var(--text-secondary)]">
              私有部署 · 账号资料与凭据管理
            </p>
          </div>
        </div>

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
                      ? 'border border-[#1677ff]/24 bg-[#1677ff]/14 font-semibold text-[#0d4bb3] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]'
                      : 'font-medium text-[var(--text-primary)]/92 hover:bg-white/58',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active
                          ? 'text-[var(--accent)]'
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
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[#1677ff]/16 text-[#1565d8]',
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

        {/* 系统设置二级导航 */}
        {secondaryNav && secondaryNav.items.length > 0 && (
          <section
            aria-label={secondaryNav.title ?? '系统设置分组'}
            className="border-t border-[var(--nav-divider)] pt-3"
          >
            {secondaryNav.title && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-[#475467]">
                {secondaryNav.title}
              </p>
            )}
            <nav
              aria-label={secondaryNav.ariaLabel ?? '系统设置二级导航'}
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
                        ? 'border border-[#1677ff]/26 bg-[#1677ff]/14 font-semibold text-[#0d4bb3] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]'
                        : 'font-medium text-[#3b475c] hover:bg-white/58 hover:text-[var(--text-primary)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full transition-colors',
                        subActive ? 'bg-[var(--accent)]' : 'bg-[#98b4d8]/75',
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

      {/* 底部：系统运行状态 */}
      <div className="space-y-2">
        <section
          data-slot="system-status-card"
          aria-label="系统运行状态"
          className="rounded-2xl border border-white/75 bg-white/52 p-3 shadow-[0_6px_18px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.85)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--table-divider)] pb-2">
            <span
              aria-hidden="true"
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                status.healthy
                  ? 'bg-[var(--success)] shadow-[0_0_0_3px_rgba(47,191,113,0.18)]'
                  : 'bg-[var(--warning)] shadow-[0_0_0_3px_rgba(245,166,35,0.18)]',
              )}
            />
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">
              {status.headline}
            </span>
          </div>
          <ul className="mt-2.5 space-y-1.5 text-[11px] leading-4 text-[var(--text-secondary)]">
            {healthItems.map((item) => (
              <li
                key={item}
                data-dynamic={
                  item.startsWith('最近备份：') ? 'timestamp' : undefined
                }
                className="flex items-center gap-1.5"
              >
                <CheckCircle2
                  className="size-3.5 shrink-0 text-[var(--success)]"
                  aria-hidden="true"
                />
                <span className="truncate">{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-center text-[11px] tabular-nums text-[var(--text-secondary)]/85">
          {status.version}
        </p>
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
    storageUsedLabel = '1.2 GB / 10 GB',
    storagePercent = 12,
    onSelectSection,
    onSelectTag,
    onAddTag,
    onOpenAudit,
    onOpenBackup,
    className,
  } = props;

  const sections: {
    key: SidebarSectionKey;
    label: string;
    count: number;
    indicator:
      'mail' | 'green-dot' | 'orange-dot' | 'gray-dot' | 'archive' | 'trash';
  }[] = [
    { key: 'all', label: '全部账号', count: counts.all, indicator: 'mail' },
    {
      key: 'normal',
      label: '正常账号',
      count: counts.normal,
      indicator: 'green-dot',
    },
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
              active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]',
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
      case 'orange-dot':
        return (
          <span
            aria-hidden="true"
            className="mx-1 size-2 shrink-0 rounded-full bg-[var(--warning)]"
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
              active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]',
            )}
            aria-hidden="true"
          />
        );
      case 'trash':
        return (
          <Trash2
            className={cn(
              'size-4 shrink-0',
              active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]',
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
        'macos-nav-surface flex w-full shrink-0 flex-col justify-between gap-5 border-b border-[var(--nav-divider)] p-4 lg:w-[224px] lg:border-r lg:border-b-0',
        className,
      )}
    >
      <div className="flex flex-col gap-5">
        {/* 分区 1：账号管理 */}
        <section aria-label="账号分类">
          <p className="mb-2 px-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
            账号管理
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
                    'flex h-[38px] w-full items-center justify-between rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
                    active
                      ? 'border border-[#1677ff]/20 bg-[#1677ff]/14 font-semibold text-[#1158c7] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]'
                      : 'font-medium text-[var(--text-primary)]/90 hover:bg-white/55',
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
                        ? 'bg-white/75 text-[#1158c7]'
                        : 'bg-white/55 text-[var(--text-secondary)]',
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
            <button
              type="button"
              aria-label="新增标签"
              title="管理与新增标签"
              onClick={onAddTag}
              className="inline-flex size-6 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/65 hover:text-[var(--text-primary)]"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
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
                      'flex h-[36px] w-full items-center justify-between rounded-xl px-2.5 text-[13px] transition-all duration-[180ms] ease-out',
                      active
                        ? 'border border-[#1677ff]/20 bg-[#1677ff]/14 font-semibold text-[#1158c7]'
                        : 'font-medium text-[var(--text-primary)]/90 hover:bg-white/55',
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
                      <span className="ml-2 rounded-full bg-white/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
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

        {/* 分区 3：其他入口 */}
        <section
          aria-label="运维入口"
          className="border-t border-[var(--nav-divider)] pt-4"
        >
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onOpenAudit}
              className="flex h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-[var(--text-primary)]/90 transition-all duration-[180ms] ease-out hover:bg-white/55"
            >
              <FileText
                className="size-4 shrink-0 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>审计日志</span>
            </button>
            <button
              type="button"
              onClick={onOpenBackup}
              className="flex h-[38px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-medium text-[var(--text-primary)]/90 transition-all duration-[180ms] ease-out hover:bg-white/55"
            >
              <Database
                className="size-4 shrink-0 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>备份与恢复</span>
            </button>
          </div>
        </section>
      </div>

      {/* 底部：数据存储卡片 */}
      <div
        data-slot="storage-card"
        className="rounded-2xl border border-white/75 bg-white/55 p-3.5 shadow-[0_6px_18px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.85)]"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Cloud className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              数据存储
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-[var(--text-secondary)]">
              {storageUsedLabel}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <div
            role="progressbar"
            aria-label="数据存储使用比例"
            aria-valuenow={storagePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1677ff]/15"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-[200ms] ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, storagePercent))}%`,
              }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
            {storagePercent}%
          </span>
        </div>
      </div>
    </aside>
  );
}
