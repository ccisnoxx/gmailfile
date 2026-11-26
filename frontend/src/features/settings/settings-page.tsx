import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import {
  CheckCircle2,
  Cpu,
  HardDrive,
  Keyboard,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import type { SessionResponse } from '@/api/generated';
import { Providers } from '@/app/providers';
import {
  EmptyState,
  persistDisplaySettings,
  persistNavAlpha,
  readDisplaySettings,
  readStoredNavAlpha,
  SETTINGS_DEFAULT_NAV_ALPHA,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  type DisplaySettingsState,
  type WorkspaceNavKey,
} from '@/components/macos';
import { ActiveSessionsCard } from './active-sessions-card';
import { AdminSecurityCard } from './admin-security-card';
import { AppearanceCard } from './appearance-card';
import { AuditLogCard } from './audit-log-card';
import { BackupRestoreCard } from './backup-restore-card';
import { RetentionPolicyCard } from './retention-policy-card';
import { SensitiveActionDialog } from './sensitive-action-dialog';
import { SettingsCardShell } from './settings-card-shell';
import { SettingsLayout, type SettingsToast } from './settings-layout';
import {
  ChangePasswordModal,
  RecoveryCodesModal,
  RestoreVerifyModal,
  RetentionPolicySheet,
} from './settings-modals';
import { SettingsSegmentedTabs } from './settings-segmented-tabs';
import { TotpSecurityCard } from './totp-security-card';
import { TotpSetupModal } from './totp-setup-modal';
import { WebAuthnSecurityCard } from './webauthn-security-card';
import { isWebAuthnSupported } from '@/lib/webauthn';
import {
  isSettingsSectionKey,
  type ActiveSessionRow,
  type CardStateMode,
  type SettingsSectionKey,
  type WebAuthnCredentialRow,
} from './types';
import { useSettingsData } from './use-settings-data';

type PendingSensitiveAction =
  | { kind: 'terminate-session'; session: ActiveSessionRow }
  | { kind: 'logout-others' }
  | { kind: 'reverify' }
  | { kind: 'register-webauthn'; label: string }
  | { kind: 'delete-webauthn'; credential: WebAuthnCredentialRow }
  | { kind: 'disable-totp' };

type SearchableCardId =
  | 'admin'
  | 'totp'
  | 'webauthn'
  | 'sessions'
  | 'backup'
  | 'audit'
  | 'retention'
  | 'appearance'
  | 'runtime';

const CARD_SEARCH_INDEX: Record<SearchableCardId, string> = {
  admin: '管理员安全 admin 密码强度 16位 泄露密码 密码短语 修改密码 重新验证',
  totp: '双因素认证 totp 2fa google authenticator microsoft 备用恢复码 验证码 演示状态 停用',
  webauthn:
    '通行密钥 webauthn fido2 passkey touch id yubikey 硬件安全密钥 生物识别 无密码登录',
  sessions:
    '活动会话 设备 浏览器 macos safari windows chrome ip 登录时间 终止 退出其他会话',
  backup:
    '加密备份与恢复 pg_dump age 立即备份 恢复验证 结构 约束 抽样解密 异地备份',
  audit: '审计日志 登录成功 修改账号 自动备份 导出 csv 哈希链 合规',
  retention: '日志保留与数据生命周期 730 90 存储占用 调整策略 清理',
  appearance:
    '界面与体验 导航栏毛玻璃透明度 滑块 预览 紧凑模式 流动背景 动画 localstorage 深色模式 浅色 跟随系统 主题 pwa 安装 桌面应用',
  runtime: '系统与维护 版本 schema 自动锁定 空闲超时 运行状态 快捷键',
};

export type SettingsPageProps = {
  mode?: 'live' | 'mock';
  initialSection?: SettingsSectionKey;
  session?: SessionResponse;
  onSession?: (value: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onRefreshSession?: () => void;
  onSignedOut?: (revocation: Promise<unknown>) => void;
  onNavigateAccounts?: (filter?: 'all' | 'archived' | 'trash' | 'tags') => void;
  onNavigateOperations?: (
    tab?: 'status' | 'import' | 'export' | 'audit',
  ) => void;
  onNavigateRecoveryUsage?: () => void;
  onLogout?: () => void;
  uiStateOverride?: CardStateMode;
  simulateActionFailure?: boolean;
};

function useSettingsDisplayPrefs() {
  const [navAlpha, setNavAlpha] = useState<number>(() =>
    readStoredNavAlpha(SETTINGS_DEFAULT_NAV_ALPHA),
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );

  useEffect(() => {
    const unsubAlpha = subscribeNavAlpha(
      setNavAlpha,
      SETTINGS_DEFAULT_NAV_ALPHA,
    );
    const unsubDisplay = subscribeDisplaySettings(setDisplaySettings);
    return () => {
      unsubAlpha();
      unsubDisplay();
    };
  }, []);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  const handleDisplaySettingsChange = useCallback(
    (next: DisplaySettingsState) => {
      setDisplaySettings(next);
      persistDisplaySettings(next);
    },
    [],
  );

  return {
    navAlpha,
    handleNavAlphaChange,
    displaySettings,
    handleDisplaySettingsChange,
  };
}

function useSettingsToast() {
  const [toast, setToast] = useState<SettingsToast | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const showToast = useCallback(
    (message: string, kind: SettingsToast['kind'] = 'success') => {
      setToast({ message, kind });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 3600);
    },
    [],
  );

  const dismissToast = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast, showToast, dismissToast };
}

export function SettingsPage(props: SettingsPageProps) {
  const existingQueryClient = useContext(QueryClientContext);
  const inRouter = useInRouterContext();
  const content = inRouter ? (
    <RoutedSettingsPage {...props} />
  ) : (
    <SettingsPageBody {...props} />
  );
  if (!existingQueryClient) {
    return <Providers>{content}</Providers>;
  }
  return content;
}

export function SettingsPreviewPage(
  props: Omit<SettingsPageProps, 'mode' | 'session'>,
) {
  return <SettingsPage {...props} mode="mock" />;
}

function RoutedSettingsPage(props: SettingsPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const isPreview = props.mode === 'mock';
  const basePrefix = isPreview ? '/preview/settings' : '/settings';

  const routeSection: SettingsSectionKey = isSettingsSectionKey(params.section)
    ? params.section
    : (props.initialSection ?? 'security');

  const handleSectionRoute = useCallback(
    (section: SettingsSectionKey) => {
      void navigate({
        pathname: `${basePrefix}/${section}`,
        search: window.location.search,
      });
    },
    [basePrefix, navigate],
  );

  const handleWorkspaceNav = useCallback(
    (key: WorkspaceNavKey) => {
      if (key === 'settings') {
        handleSectionRoute('security');
        return;
      }
      if (key === 'audit') {
        handleSectionRoute('audit');
        return;
      }
      if (key === 'backup') {
        handleSectionRoute('backup');
        return;
      }
      if (
        props.onNavigateAccounts &&
        (key === 'dashboard' ||
          key === 'accounts' ||
          key === 'tags' ||
          key === 'archived' ||
          key === 'trash')
      ) {
        props.onNavigateAccounts(
          key === 'archived'
            ? 'archived'
            : key === 'trash'
              ? 'trash'
              : key === 'tags'
                ? 'tags'
                : 'all',
        );
        return;
      }
      if (props.onNavigateOperations && key === 'transfer') {
        props.onNavigateOperations('import');
        return;
      }
      if (isPreview) {
        if (
          key === 'dashboard' ||
          key === 'accounts' ||
          key === 'tags' ||
          key === 'archived' ||
          key === 'trash'
        ) {
          void navigate('/preview/accounts');
        } else if (key === 'transfer') {
          void navigate('/preview/transfers/csv');
        }
        return;
      }
      if (key === 'dashboard' || key === 'accounts') {
        void navigate('/accounts');
      } else if (key === 'tags') {
        void navigate('/accounts?modal=tags');
      } else if (key === 'archived') {
        void navigate('/accounts?archived=true');
      } else if (key === 'trash') {
        void navigate('/accounts?deleted=true');
      } else if (key === 'transfer') {
        void navigate('/transfers/csv');
      }
    },
    [
      handleSectionRoute,
      isPreview,
      navigate,
      props.onNavigateAccounts,
      props.onNavigateOperations,
    ],
  );

  return (
    <SettingsPageBody
      {...props}
      controlledSection={routeSection}
      onSectionChange={handleSectionRoute}
      onWorkspaceNav={handleWorkspaceNav}
    />
  );
}

function SettingsPageBody({
  mode = 'mock',
  initialSection = 'security',
  controlledSection,
  onSectionChange,
  onWorkspaceNav,
  session,
  onSession,
  onFailure,
  onRefreshSession,
  onSignedOut,
  onNavigateOperations,
  onNavigateRecoveryUsage,
  onLogout,
  uiStateOverride,
  simulateActionFailure = false,
}: SettingsPageProps & {
  controlledSection?: SettingsSectionKey;
  onSectionChange?: (section: SettingsSectionKey) => void;
  onWorkspaceNav?: (key: WorkspaceNavKey) => void;
}) {
  const [localSection, setLocalSection] =
    useState<SettingsSectionKey>(initialSection);
  const activeSection = controlledSection ?? localSection;

  const handleSelectSection = useCallback(
    (section: SettingsSectionKey) => {
      setLocalSection(section);
      onSectionChange?.(section);
    },
    [onSectionChange],
  );

  // URL ?ui_state=loading|error|empty 仅在演示或本地开发模式启用，生产实时页面禁止通过 URL 覆盖状态
  const resolvedUiState = useMemo<CardStateMode | undefined>(() => {
    if (uiStateOverride) return uiStateOverride;
    if (mode !== 'mock' && !import.meta.env.DEV) return undefined;
    if (typeof window === 'undefined') return undefined;
    const raw = new URLSearchParams(window.location.search).get('ui_state');
    if (raw === 'loading' || raw === 'error' || raw === 'empty') return raw;
    return undefined;
  }, [mode, uiStateOverride]);

  const {
    navAlpha,
    handleNavAlphaChange,
    displaySettings,
    handleDisplaySettingsChange,
  } = useSettingsDisplayPrefs();

  const { toast, showToast, dismissToast } = useSettingsToast();

  const data = useSettingsData({
    mode,
    session,
    onSession,
    onFailure,
    onRefreshSession,
    onSignedOut,
    uiStateOverride: resolvedUiState,
    simulateActionFailure,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [totpSetupModalOpen, setTotpSetupModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedRestoreArchiveId, setSelectedRestoreArchiveId] = useState<
    string | null
  >(null);
  const [retentionSheetOpen, setRetentionSheetOpen] = useState(false);
  const [sensitiveAction, setSensitiveAction] =
    useState<PendingSensitiveAction | null>(null);

  // 支持从全局 /settings/security?action=reverify 快捷入口直接弹出二次验证弹窗
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'reverify') {
      setSensitiveAction({ kind: 'reverify' });
      params.delete('action');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, []);

  const handleRunBackup = useCallback(async () => {
    const result = await data.handlers.runImmediateBackup();
    if (result.ok) {
      showToast(result.message ?? '加密备份已完成。', 'success');
    } else {
      showToast(result.error, 'error');
    }
  }, [data.handlers, showToast]);

  const handleWorkspaceNavFallback = useCallback(
    (key: WorkspaceNavKey) => {
      if (onWorkspaceNav) {
        onWorkspaceNav(key);
        return;
      }
      if (key === 'audit') handleSelectSection('audit');
      else if (key === 'backup') handleSelectSection('backup');
      else if (key === 'settings') handleSelectSection('security');
      else
        showToast('当前处于独立预览模式，请通过应用路由返回工作区。', 'info');
    },
    [handleSelectSection, onWorkspaceNav, showToast],
  );

  const handleViewFullAuditLog = useCallback(() => {
    if (onNavigateOperations) {
      onNavigateOperations('audit');
      return;
    }
    handleSelectSection('audit');
  }, [handleSelectSection, onNavigateOperations]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchedCardIds = useMemo<SearchableCardId[] | null>(() => {
    if (!normalizedSearch) return null;
    return (Object.keys(CARD_SEARCH_INDEX) as SearchableCardId[]).filter((id) =>
      CARD_SEARCH_INDEX[id].toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch]);

  // 7 张核心卡片实例工厂
  const renderCard = (id: SearchableCardId, opts?: { expanded?: boolean }) => {
    switch (id) {
      case 'admin':
        return (
          <AdminSecurityCard
            key="admin"
            info={data.adminSecurity}
            isRecentlyVerified={data.isRecentlyVerified}
            state={resolvedUiState ?? 'ready'}
            onOpenChangePassword={() => setPasswordModalOpen(true)}
            onOpenReverify={() => setSensitiveAction({ kind: 'reverify' })}
            onRetry={data.handlers.retryAll}
          />
        );
      case 'totp':
        return (
          <TotpSecurityCard
            key="totp"
            info={data.totpSecurity}
            state={resolvedUiState ?? 'ready'}
            canDisable={data.webauthnCredentials.length > 0}
            onOpenRecoveryCodes={() => setRecoveryModalOpen(true)}
            onOpenTotpSetup={() => setTotpSetupModalOpen(true)}
            onDisableTotp={() => setSensitiveAction({ kind: 'disable-totp' })}
            onRetry={data.handlers.retryAll}
          />
        );
      case 'webauthn':
        return (
          <WebAuthnSecurityCard
            key="webauthn"
            credentials={data.webauthnCredentials}
            totpEnabled={data.totpSecurity.enabled}
            state={data.webauthnState}
            errorText={data.webauthnError}
            onRegister={async (label) => {
              if (!data.isRecentlyVerified) {
                setSensitiveAction({ kind: 'register-webauthn', label });
                return { ok: true };
              }
              const res = await data.handlers.registerWebAuthnCredential(label);
              if (res.ok) {
                showToast(res.message ?? '通行密钥已绑定。', 'success');
              } else if (res.requireReauth) {
                setSensitiveAction({ kind: 'register-webauthn', label });
                return { ok: true };
              }
              return res;
            }}
            onRename={async (id, label) => {
              const res = await data.handlers.renameWebAuthnCredential(
                id,
                label,
              );
              if (res.ok) {
                showToast(res.message ?? '通行密钥已重命名。', 'success');
              }
              return res;
            }}
            onDeleteRequest={(credential) =>
              setSensitiveAction({ kind: 'delete-webauthn', credential })
            }
            onRetry={data.handlers.retryAll}
          />
        );
      case 'sessions':
        return (
          <ActiveSessionsCard
            key="sessions"
            sessions={data.sessions}
            state={data.sessionsState}
            errorText={data.sessionsError}
            onTerminateSession={(row) =>
              setSensitiveAction({ kind: 'terminate-session', session: row })
            }
            onLogoutOtherSessions={() =>
              setSensitiveAction({ kind: 'logout-others' })
            }
            onRetry={data.handlers.retryAll}
          />
        );
      case 'backup':
        return (
          <BackupRestoreCard
            key="backup"
            info={data.backup}
            running={data.backupRunning}
            state={data.backupState}
            errorText={data.backupError}
            webActionsSupported={mode === 'mock'}
            onRunBackup={() => void handleRunBackup()}
            onOpenRestoreVerify={() => {
              setSelectedRestoreArchiveId(null);
              setRestoreModalOpen(true);
            }}
            onRetry={data.handlers.retryAll}
          />
        );
      case 'audit':
        return (
          <AuditLogCard
            key="audit"
            entries={data.audits}
            state={data.auditsState}
            errorText={data.auditsError}
            maxRows={opts?.expanded ? 20 : 6}
            expanded={Boolean(opts?.expanded)}
            onViewFullLog={handleViewFullAuditLog}
            onRetry={data.handlers.retryAll}
          />
        );
      case 'retention':
        return (
          <RetentionPolicyCard
            key="retention"
            policy={data.retention}
            state={data.retentionState}
            errorText={data.retentionError}
            onAdjustPolicy={() => setRetentionSheetOpen(true)}
            onRetry={data.handlers.retryAll}
          />
        );
      case 'appearance':
        return (
          <AppearanceCard
            key="appearance"
            navAlpha={navAlpha}
            onNavAlphaChange={handleNavAlphaChange}
            displaySettings={displaySettings}
            onDisplaySettingsChange={handleDisplaySettingsChange}
            showDisplayToggles={Boolean(opts?.expanded)}
          />
        );
      case 'runtime':
        return (
          <SettingsCardShell
            key="runtime"
            id="settings-card-runtime"
            title="运行环境与会话安全"
            subtitle="服务版本、数据库 Schema 与空闲自动锁定策略"
            icon={<Cpu className="size-4" />}
            state={data.runtimeState}
            onRetry={data.handlers.retryAll}
            headerRight={
              <button
                type="button"
                onClick={() => setRetentionSheetOpen(true)}
                className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/72 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white"
              >
                调整自动锁定…
              </button>
            }
          >
            <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-white/75 bg-white/44 p-3.5 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-[var(--text-secondary)]">
                  应用版本 / Schema
                </dt>
                <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                  {data.runtime.appVersion} / {data.runtime.schemaVersion}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-[var(--text-secondary)]">
                  空闲自动锁定
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">
                  {data.runtime.idleMinutes} 分钟
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-[var(--text-secondary)]">
                  凭据存储加密
                </dt>
                <dd className="mt-0.5 font-medium text-[var(--text-primary)]">
                  AES-256-GCM 独立字段加密
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-[var(--text-secondary)]">
                  敏感缓存策略
                </dt>
                <dd className="mt-0.5 font-medium text-[var(--success-text)]">
                  禁止写入 Query Cache 与 localStorage
                </dd>
              </div>
            </dl>
          </SettingsCardShell>
        );
    }
  };

  const renderSectionContent = () => {
    // 顶部设置搜索过滤视图
    if (matchedCardIds !== null) {
      if (matchedCardIds.length === 0) {
        return (
          <EmptyState
            title="未找到匹配的设置项"
            description={`没有与“${searchQuery.trim()}”相关的配置卡片，可尝试搜索“密码”、“TOTP”、“备份”、“审计”或“透明度”。`}
            createLabel="清空搜索条件"
            onCreate={() => setSearchQuery('')}
          />
        );
      }
      const leftCards = matchedCardIds.filter((_, idx) => idx % 2 === 0);
      const rightCards = matchedCardIds.filter((_, idx) => idx % 2 === 1);
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-white/75 bg-white/46 px-4 py-2 text-[12.5px] text-[var(--text-secondary)]">
            <span>
              搜索“
              <strong className="text-[var(--text-primary)]">
                {searchQuery.trim()}
              </strong>
              ”，共匹配 {matchedCardIds.length} 项设置卡片
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="font-medium text-[var(--accent)] hover:underline"
            >
              清空搜索
            </button>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              {leftCards.map((id) =>
                renderCard(id, { expanded: id === 'appearance' }),
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {rightCards.map((id) =>
                renderCard(id, { expanded: id === 'appearance' }),
              )}
            </div>
          </div>
        </div>
      );
    }

    switch (activeSection) {
      case 'security':
        // 默认主视图：两列自然高度卡片网格，间距 16px（gap-4），完整呈现 7 张核心管理卡片
        return (
          <div
            data-slot="settings-card-grid"
            className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
          >
            <div className="flex min-w-0 flex-col gap-4">
              {renderCard('admin')}
              {renderCard('sessions')}
              {renderCard('audit')}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {renderCard('totp')}
              {renderCard('webauthn')}
              {renderCard('backup')}
              {renderCard('retention')}
              {renderCard('appearance')}
            </div>
          </div>
        );

      case 'backup':
        return (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              {renderCard('backup')}
              <SettingsCardShell
                title="最近加密归档快照"
                subtitle="经 age 公钥加密的 PostgreSQL 逻辑备份清单"
                icon={<HardDrive className="size-4" />}
                state={
                  data.backupState === 'loading' || data.backupState === 'error'
                    ? data.backupState
                    : data.backup.archives.length === 0
                      ? 'empty'
                      : 'ready'
                }
                emptyTitle="暂无归档快照"
                emptyDescription={
                  mode === 'live'
                    ? '加密归档文件保存在部署主机受保护目录，请通过主机备份与离线恢复演练脚本查看并验证。'
                    : '执行一次立即备份后将在此列出最近加密归档。'
                }
                onRetry={data.handlers.retryAll}
              >
                <ul className="divide-y divide-[var(--table-divider)] rounded-2xl border border-white/75 bg-white/44">
                  {data.backup.archives.map((archive) => (
                    <li
                      key={archive.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[12.5px]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono font-semibold text-[var(--text-primary)]">
                          {archive.filename}
                        </p>
                        <p className="text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                          {archive.createdAt} · {archive.sizeLabel} ·{' '}
                          {archive.checksumShort}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRestoreArchiveId(archive.id);
                          setRestoreModalOpen(true);
                        }}
                        className="rounded-lg border border-white/85 bg-white/75 px-2.5 py-1 text-[12px] font-medium text-[var(--accent-text)] hover:bg-white"
                      >
                        验证此备份
                      </button>
                    </li>
                  ))}
                </ul>
              </SettingsCardShell>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {renderCard('retention')}
              <SettingsCardShell
                title="异地传输与加密基线"
                subtitle="备份链路完整性与密钥隔离约束"
                icon={<Lock className="size-4" />}
              >
                <dl className="space-y-2.5 text-[13px]">
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--text-secondary)]">
                      异地传输状态
                    </dt>
                    <dd className="font-medium text-[var(--text-primary)]">
                      {data.backup.offsiteState === 'success'
                        ? '已同步至异地加密仓库'
                        : data.backup.offsiteState === 'failed'
                          ? '异地同步失败，需排查'
                          : data.backup.offsiteState === 'pending'
                            ? '同步中'
                            : '未配置异地目标'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--text-secondary)]">加密方案</dt>
                    <dd className="font-medium text-[var(--text-primary)]">
                      pg_dump + age 非对称加密
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[var(--text-secondary)]">私钥隔离</dt>
                    <dd className="font-medium text-[var(--success-text)]">
                      在线服务器仅持有加密公钥
                    </dd>
                  </div>
                </dl>
              </SettingsCardShell>
            </div>
          </div>
        );

      case 'audit':
        return (
          <div className="flex flex-col gap-4">
            {renderCard('audit', { expanded: true })}
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <SettingsCardShell
                title="防篡改哈希链校验"
                subtitle="逐条验证审计事件序列连续性与 SHA-256 链尾摘要"
                icon={<ShieldCheck className="size-4" />}
                state={data.auditIntegrityState}
                onRetry={data.handlers.retryAll}
              >
                {data.auditIntegrity ? (
                  <div className="space-y-3">
                    <div
                      className={
                        data.auditIntegrity.valid
                          ? 'flex items-center gap-2 rounded-2xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--badge-green-text)]'
                          : 'flex items-center gap-2 rounded-2xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--badge-red-text)]'
                      }
                    >
                      {data.auditIntegrity.valid ? (
                        <>
                          <CheckCircle2
                            className="size-4 shrink-0 text-[var(--success)]"
                            aria-hidden="true"
                          />
                          <span>审计哈希链完整无篡改</span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert
                            className="size-4 shrink-0 text-[var(--danger)]"
                            aria-hidden="true"
                          />
                          <span>
                            检测到链完整性异常
                            {data.auditIntegrity.brokenSeq != null
                              ? `（序号 #${data.auditIntegrity.brokenSeq}）`
                              : ''}
                          </span>
                        </>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-2.5 rounded-2xl border border-white/75 bg-white/44 p-3.5 text-[12.5px]">
                      <div>
                        <dt className="text-[var(--text-secondary)]">
                          事件总数
                        </dt>
                        <dd className="mt-0.5 font-semibold tabular-nums">
                          {data.auditIntegrity.totalEvents} 条
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-secondary)]">
                          最新序号
                        </dt>
                        <dd className="mt-0.5 font-mono font-semibold">
                          {data.auditIntegrity.latestSeq != null
                            ? `#${data.auditIntegrity.latestSeq}`
                            : '—'}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-[var(--text-secondary)]">
                          链尾摘要
                        </dt>
                        <dd
                          data-dynamic="id"
                          className="mt-0.5 font-mono text-[12px] text-[var(--text-primary)]"
                        >
                          {data.auditIntegrity.latestHashShort ?? '—'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--text-secondary)]">
                    暂无哈希链校验报告。
                  </p>
                )}
              </SettingsCardShell>
              {renderCard('retention')}
            </div>
          </div>
        );

      case 'appearance':
        return (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {renderCard('appearance', { expanded: true })}
            <SettingsCardShell
              title="交互快捷键与本地存储约束"
              subtitle="键盘可达性支持与浏览器偏好隔离原则"
              icon={<Keyboard className="size-4" />}
            >
              <dl className="space-y-2.5 rounded-2xl border border-white/75 bg-white/44 p-3.5 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">聚焦设置搜索</dt>
                  <dd className="rounded-md border border-[var(--border)] bg-white/80 px-2 py-0.5 font-mono text-[12px]">
                    ⌘K / Ctrl+K
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">切换分类标签</dt>
                  <dd className="rounded-md border border-[var(--border)] bg-white/80 px-2 py-0.5 font-mono text-[12px]">
                    ← / → / Home / End
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">
                    关闭弹窗与抽屉
                  </dt>
                  <dd className="rounded-md border border-[var(--border)] bg-white/80 px-2 py-0.5 font-mono text-[12px]">
                    Esc
                  </dd>
                </div>
              </dl>
              <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                本地存储（localStorage）仅保存导航栏透明度、流动背景、动画开关与紧凑模式等非敏感界面偏好，绝不保存任何密码、TOTP
                密钥或恢复码。
              </p>
            </SettingsCardShell>
          </div>
        );

      case 'system':
        return (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              {renderCard('runtime')}
              {renderCard('sessions')}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {renderCard('retention')}
              {renderCard('backup')}
            </div>
          </div>
        );
    }
  };

  // 当前待确认的 SensitiveActionDialog 配置
  const sensitiveDialogConfig = useMemo(() => {
    if (!sensitiveAction) return null;
    if (sensitiveAction.kind === 'terminate-session') {
      const target = sensitiveAction.session;
      return {
        title: target.current ? '终止当前管理会话？' : '终止活动会话？',
        description: `${target.deviceBrowser} · ${target.ipAddress}`,
        riskSummary: target.current
          ? '终止当前会话将立即退出控制台并清空本地工作区内存状态。'
          : `终止后，${target.deviceBrowser} 上的管理员登录状态将立即失效。`,
        riskPoints: [
          '该终端需要重新输入密码与 TOTP 验证码方可再次登录',
          '操作将记录至防篡改审计日志链',
        ],
        confirmLabel: target.current ? '确认退出当前会话' : '确认终止会话',
        tone: 'danger' as const,
        requireTotp:
          data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled,
        alwaysRequireCredentials: false,
        onConfirm: (verify?: { password?: string; totpCode?: string }) =>
          data.handlers.terminateSession(target.id, verify),
      };
    }
    if (sensitiveAction.kind === 'logout-others') {
      return {
        title: '退出全部其他会话？',
        description: '保留当前终端，立即撤销所有其他设备上的已登录会话',
        riskSummary:
          '其他所有已登录的浏览器和设备将被强制下线，不会延长当前会话的有效期。',
        riskPoints: [
          '若怀疑凭据泄露，建议同时修改管理员密码并重新生成恢复码',
          '撤销结果将以服务端响应为准，失败时不会自动重试',
        ],
        confirmLabel: '确认退出其他会话',
        tone: 'danger' as const,
        requireTotp:
          data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled,
        alwaysRequireCredentials: false,
        onConfirm: (verify?: { password?: string; totpCode?: string }) =>
          data.handlers.logoutOtherSessions(verify),
      };
    }
    if (sensitiveAction.kind === 'register-webauthn') {
      return {
        title: '验证后绑定新通行密钥',
        description: `设备名称：${sensitiveAction.label}`,
        riskSummary:
          '绑定新的 WebAuthn/Passkey 属于高敏操作，需先完成最近 5 分钟内的身份二次验证。',
        riskPoints: [
          '新绑定的通行密钥可直接用于无密码登录与高风险 Step-Up 验证',
          '操作将记录至防篡改审计日志链',
        ],
        confirmLabel: '验证并开始绑定',
        tone: 'primary' as const,
        requireTotp:
          data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled,
        alwaysRequireCredentials: false,
        onConfirm: (verify?: { password?: string; totpCode?: string }) =>
          data.handlers.registerWebAuthnCredential(
            sensitiveAction.label,
            verify,
          ),
      };
    }
    if (sensitiveAction.kind === 'delete-webauthn') {
      const target = sensitiveAction.credential;
      return {
        title: '移除通行密钥？',
        description: target.label,
        riskSummary: `移除后，通行密钥「${target.label}」将立即失效，无法再用于登录或 Step-Up 验证。`,
        riskPoints: [
          '当 TOTP 未启用时，系统会保护最后一个通行密钥不被删除',
          '操作将记录至防篡改审计日志链',
        ],
        confirmLabel: '确认移除通行密钥',
        tone: 'danger' as const,
        requireTotp:
          data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled,
        alwaysRequireCredentials: false,
        onConfirm: (verify?: { password?: string; totpCode?: string }) =>
          data.handlers.deleteWebAuthnCredential(target.id, verify),
      };
    }
    if (sensitiveAction.kind === 'disable-totp') {
      return {
        title: '停用 TOTP 验证器？',
        description:
          '仅保留已绑定的通行密钥（Passkey）与离线恢复码作为二步验证',
        riskSummary:
          '停用 TOTP 后将清除服务端 TOTP 密钥并退出全部其他设备会话，日常登录请使用通行密钥。',
        riskPoints: [
          '停用前必须确保至少保留 1 个可用的通行密钥（Passkey）',
          '离线恢复/数据库切换脚本将自动改用一次性恢复码作为二步兜底',
        ],
        confirmLabel: '确认停用 TOTP',
        tone: 'danger' as const,
        requireTotp:
          data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled,
        alwaysRequireCredentials: false,
        onConfirm: (verify?: { password?: string; totpCode?: string }) =>
          data.handlers.disableTotp(verify),
      };
    }
    return {
      title: '管理员身份重新验证',
      description: '完成验证后 5 分钟内可执行高风险安全配置操作',
      riskSummary: '请提供当前管理员凭据以开启 5 分钟高风险操作授权窗口。',
      riskPoints: ['凭据仅用于当次服务端校验，绝不写入缓存或本地存储'],
      confirmLabel: '完成重新验证',
      tone: 'primary' as const,
      requireTotp:
        data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled,
      alwaysRequireCredentials: true,
      onConfirm: (verify?: { password?: string; totpCode?: string }) =>
        data.handlers.reverify(verify?.password ?? '', verify?.totpCode),
    };
  }, [
    data.adminSecurity.stepUpTotpRequired,
    data.handlers,
    data.totpSecurity.enabled,
    sensitiveAction,
  ]);

  const canUsePasskey =
    data.webauthnCredentials.length > 0 && isWebAuthnSupported();
  const requireStepUpTotp =
    data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled;

  return (
    <>
      <SettingsLayout
        navAlpha={navAlpha}
        onNavAlphaChange={handleNavAlphaChange}
        displaySettings={displaySettings}
        onDisplaySettingsChange={handleDisplaySettingsChange}
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        onSelectWorkspaceNav={handleWorkspaceNavFallback}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        runtime={data.runtime}
        totpEnabled={data.totpSecurity.enabled}
        lastBackupLabel={data.backup.lastBackupAt ?? '尚未运行'}
        notifications={
          mode === 'live'
            ? []
            : [
                '已启用防篡改哈希链审计与高风险操作最近重新验证。',
                `最近加密备份：${data.backup.lastBackupAt ?? '尚未运行'}（${data.backup.statusLabel}）`,
              ]
        }
        onOpenSecurity={() => handleSelectSection('security')}
        onOpenRecoveryUsage={
          onNavigateRecoveryUsage ??
          (() => handleWorkspaceNavFallback('accounts'))
        }
        onLogout={() => {
          if (onLogout) onLogout();
          else
            showToast('当前为本地预览模式，退出登录需连接后端会话。', 'info');
        }}
        headerActions={
          mode === 'live' ? (
            <button
              type="button"
              onClick={data.handlers.retryAll}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/80 bg-white/62 px-3 text-[12.5px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-colors hover:bg-white/88"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>刷新状态</span>
            </button>
          ) : undefined
        }
        segmentedTabs={
          <SettingsSegmentedTabs
            activeSection={activeSection}
            onChange={handleSelectSection}
          />
        }
        toast={toast}
        onDismissToast={dismissToast}
      >
        <div
          role="tabpanel"
          id={`settings-tabpanel-${activeSection}`}
          aria-labelledby={`settings-tab-${activeSection}`}
        >
          {renderSectionContent()}
        </div>
      </SettingsLayout>

      {/* 修改密码 Modal */}
      <ChangePasswordModal
        open={passwordModalOpen}
        onOpenChange={setPasswordModalOpen}
        isRecentlyVerified={data.isRecentlyVerified}
        requireStepUpTotp={requireStepUpTotp}
        canUsePasskey={canUsePasskey}
        onPasskeyVerify={data.handlers.passkeyReverify}
        onSubmit={data.handlers.changePassword}
        onSuccess={(msg) => showToast(msg ?? '管理员密码已修改。', 'success')}
      />

      {/* 查看 / 重新生成恢复码 Modal */}
      <RecoveryCodesModal
        open={recoveryModalOpen}
        onOpenChange={setRecoveryModalOpen}
        remainingCount={data.totpSecurity.recoveryCodesRemaining}
        totalCount={data.totpSecurity.recoveryCodesTotal}
        onRegenerate={data.handlers.regenerateRecoveryCodes}
        onSuccess={(msg) =>
          showToast(msg ?? '新的备用恢复码已生成，请离线保存。', 'success')
        }
      />

      {/* 绑定 / 重绑 TOTP 验证器 Modal */}
      <TotpSetupModal
        open={totpSetupModalOpen}
        onOpenChange={setTotpSetupModalOpen}
        isRebind={data.totpSecurity.enabled}
        isRecentlyVerified={data.isRecentlyVerified}
        canUsePasskey={canUsePasskey}
        onPasskeyVerify={data.handlers.passkeyReverify}
        onStartSetup={data.handlers.startTotpSetup}
        onConfirmSetup={data.handlers.confirmTotpSetup}
        onSuccess={(msg) =>
          showToast(msg ?? 'TOTP 验证器已更新，请妥善保存新恢复码。', 'success')
        }
      />

      {/* 步骤式恢复验证 Modal */}
      <RestoreVerifyModal
        open={restoreModalOpen}
        onOpenChange={(next) => {
          setRestoreModalOpen(next);
          if (!next) setSelectedRestoreArchiveId(null);
        }}
        archives={data.backup.archives}
        initialArchiveId={selectedRestoreArchiveId}
        onRunVerification={data.handlers.runRestoreVerification}
        onComplete={(report) => {
          showToast(
            report.passed
              ? `恢复验证通过（${report.archive.filename}）`
              : (report.errorMessage ?? '恢复验证未通过，请排查归档完整性。'),
            report.passed ? 'success' : 'error',
          );
        }}
      />

      {/* 调整保留策略 Sheet */}
      <RetentionPolicySheet
        open={retentionSheetOpen}
        onOpenChange={setRetentionSheetOpen}
        policy={data.retention}
        idleMinutes={data.runtime.idleMinutes}
        maxIdleMinutes={data.runtime.maxIdleMinutes}
        isRecentlyVerified={data.isRecentlyVerified}
        requireStepUpTotp={requireStepUpTotp}
        readOnlyRetentionDays={mode === 'live'}
        canUsePasskey={canUsePasskey}
        onPasskeyVerify={data.handlers.passkeyReverify}
        onSave={data.handlers.updateRetentionPolicy}
        onSuccess={(msg) =>
          showToast(msg ?? '日志保留与数据生命周期策略已更新。', 'success')
        }
      />

      {/* 高风险确认与最近重新验证 Dialog */}
      {sensitiveDialogConfig && (
        <SensitiveActionDialog
          open={sensitiveAction !== null}
          onOpenChange={(open) => {
            if (!open) setSensitiveAction(null);
          }}
          title={sensitiveDialogConfig.title}
          description={sensitiveDialogConfig.description}
          riskSummary={sensitiveDialogConfig.riskSummary}
          riskPoints={sensitiveDialogConfig.riskPoints}
          confirmLabel={sensitiveDialogConfig.confirmLabel}
          tone={sensitiveDialogConfig.tone}
          isRecentlyVerified={data.isRecentlyVerified}
          requireTotp={sensitiveDialogConfig.requireTotp}
          alwaysRequireCredentials={
            sensitiveDialogConfig.alwaysRequireCredentials
          }
          canUsePasskey={canUsePasskey}
          onPasskeyVerify={data.handlers.passkeyReverify}
          onConfirm={sensitiveDialogConfig.onConfirm}
          onSuccess={(msg) => showToast(msg ?? '操作已完成。', 'success')}
        />
      )}
    </>
  );
}
