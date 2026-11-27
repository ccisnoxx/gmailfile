import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import type { SessionResponse } from '@/api/generated';
import {
  resolveAccountSectionHref,
  resolveAppHref,
  resolveWorkspaceNavDestination,
} from '@/app/navigation';
import { Providers } from '@/app/providers';
import {
  LoadingState,
  persistDisplaySettings,
  persistNavAlpha,
  readDisplaySettings,
  readStoredNavAlpha,
  SETTINGS_DEFAULT_NAV_ALPHA,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  useLiveSidebarData,
  type DisplaySettingsState,
  type SidebarSectionKey,
  type WorkspaceNavKey,
} from '@/components/macos';
import { isWebAuthnSupported } from '@/lib/webauthn';
import {
  matchSettingsCardIds,
  type SettingsSectionCommonProps,
} from './sections/section-shared';
import {
  buildSensitiveDialogConfig,
  type PendingSensitiveAction,
} from './sensitive-dialog-config';
import { SettingsLayout, type SettingsToast } from './settings-layout';
import { SettingsSegmentedTabs } from './settings-segmented-tabs';
import {
  isSettingsSectionKey,
  type CardStateMode,
  type SettingsSectionKey,
} from './types';
import { useSettingsData } from './use-settings-data';

const loadSecuritySection = () => import('./sections/security-section');
const loadBackupSection = () => import('./sections/backup-section');
const loadAuditSection = () => import('./sections/audit-section');
const loadAppearanceSection = () => import('./sections/appearance-section');
const loadSystemSection = () => import('./sections/system-section');
const loadSearchSection = () => import('./sections/search-section');

const LazySecuritySection = lazy(loadSecuritySection);
const LazyBackupSection = lazy(loadBackupSection);
const LazyAuditSection = lazy(loadAuditSection);
const LazyAppearanceSection = lazy(loadAppearanceSection);
const LazySystemSection = lazy(loadSystemSection);
const LazySearchSection = lazy(loadSearchSection);

const LazyChangePasswordModal = lazy(() =>
  import('./settings-modals').then((m) => ({ default: m.ChangePasswordModal })),
);
const LazyRecoveryCodesModal = lazy(() =>
  import('./settings-modals').then((m) => ({ default: m.RecoveryCodesModal })),
);
const LazyRestoreVerifyModal = lazy(() =>
  import('./settings-modals').then((m) => ({ default: m.RestoreVerifyModal })),
);
const LazyRetentionPolicySheet = lazy(() =>
  import('./settings-modals').then((m) => ({
    default: m.RetentionPolicySheet,
  })),
);
const LazyTotpSetupModal = lazy(() =>
  import('./totp-setup-modal').then((m) => ({ default: m.TotpSetupModal })),
);
const LazySensitiveActionDialog = lazy(() =>
  import('./sensitive-action-dialog').then((m) => ({
    default: m.SensitiveActionDialog,
  })),
);

function preloadSettingsSection(section: SettingsSectionKey): void {
  switch (section) {
    case 'security':
      void loadSecuritySection();
      return;
    case 'backup':
      void loadBackupSection();
      return;
    case 'audit':
      void loadAuditSection();
      return;
    case 'appearance':
      void loadAppearanceSection();
      return;
    case 'system':
      void loadSystemSection();
      return;
  }
}

export type SettingsAccountNavTarget =
  | 'all'
  | 'dashboard'
  | 'apps'
  | 'normal'
  | 'pending'
  | 'risk'
  | 'disabled'
  | 'archived'
  | 'trash'
  | 'tags'
  | `tag:${string}`;

export type SettingsPageProps = {
  mode?: 'live' | 'mock';
  initialSection?: SettingsSectionKey;
  session?: SessionResponse;
  onSession?: (value: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onRefreshSession?: () => void;
  onSignedOut?: (revocation: Promise<unknown>) => void;
  onNavigateAccounts?: (filter?: SettingsAccountNavTarget) => void;
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

function useLazyMount(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) {
    setMounted(true);
  }
  return mounted;
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

  const routeSection: SettingsSectionKey = isSettingsSectionKey(params.section)
    ? params.section
    : (props.initialSection ?? 'security');

  const handleSectionRoute = useCallback(
    (section: SettingsSectionKey) => {
      void navigate(
        resolveAppHref(
          { kind: 'settings', section, search: window.location.search },
          { preview: isPreview },
        ),
      );
    },
    [isPreview, navigate],
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
      if (key === 'recovery') {
        if (props.onNavigateRecoveryUsage) {
          props.onNavigateRecoveryUsage();
        } else {
          void navigate(
            resolveAppHref({ kind: 'recovery-emails' }, { preview: isPreview }),
          );
        }
        return;
      }
      if (
        props.onNavigateAccounts &&
        (key === 'dashboard' ||
          key === 'accounts' ||
          key === 'apps' ||
          key === 'tags' ||
          key === 'archived' ||
          key === 'trash')
      ) {
        const accountTarget: SettingsAccountNavTarget =
          key === 'accounts' ? 'all' : key;
        props.onNavigateAccounts(accountTarget);
        return;
      }
      if (props.onNavigateOperations && key === 'transfer') {
        props.onNavigateOperations('import');
        return;
      }
      void navigate(
        resolveAppHref(resolveWorkspaceNavDestination(key), {
          preview: isPreview,
        }),
      );
    },
    [
      handleSectionRoute,
      isPreview,
      navigate,
      props.onNavigateAccounts,
      props.onNavigateOperations,
      props.onNavigateRecoveryUsage,
    ],
  );

  const handleAccountSectionNav = useCallback(
    (section: SidebarSectionKey) => {
      if (props.onNavigateAccounts) {
        props.onNavigateAccounts(section);
        return;
      }
      void navigate(resolveAccountSectionHref(section, { preview: isPreview }));
    },
    [isPreview, navigate, props.onNavigateAccounts],
  );

  const handleTagNav = useCallback(
    (tagId: string) => {
      if (props.onNavigateAccounts) {
        props.onNavigateAccounts(`tag:${tagId}`);
        return;
      }
      void navigate(
        resolveAppHref(
          { kind: 'accounts', query: { tag: tagId } },
          { preview: isPreview },
        ),
      );
    },
    [isPreview, navigate, props.onNavigateAccounts],
  );

  return (
    <SettingsPageBody
      {...props}
      controlledSection={routeSection}
      onSectionChange={handleSectionRoute}
      onWorkspaceNav={handleWorkspaceNav}
      onAccountSectionNav={handleAccountSectionNav}
      onTagNav={handleTagNav}
    />
  );
}

function SettingsPageBody({
  mode = 'mock',
  initialSection = 'security',
  controlledSection,
  onSectionChange,
  onWorkspaceNav,
  onAccountSectionNav,
  onTagNav,
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
  onAccountSectionNav?: (section: SidebarSectionKey) => void;
  onTagNav?: (tagId: string) => void;
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

  const liveSidebar = useLiveSidebarData(mode === 'live' && Boolean(session));

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

  const mountPasswordModal = useLazyMount(passwordModalOpen);
  const mountRecoveryModal = useLazyMount(recoveryModalOpen);
  const mountTotpSetupModal = useLazyMount(totpSetupModalOpen);
  const mountRestoreModal = useLazyMount(restoreModalOpen);
  const mountRetentionSheet = useLazyMount(retentionSheetOpen);

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

  const handleOpenRestoreVerify = useCallback((archiveId?: string | null) => {
    setSelectedRestoreArchiveId(archiveId ?? null);
    setRestoreModalOpen(true);
  }, []);

  const matchedCardIds = useMemo(
    () => matchSettingsCardIds(searchQuery),
    [searchQuery],
  );

  const requireStepUpTotp =
    data.adminSecurity.stepUpTotpRequired && data.totpSecurity.enabled;
  const canUsePasskey =
    data.webauthnCredentials.length > 0 && isWebAuthnSupported();
  const isTotpSetupRecentlyVerified =
    !data.totpSecurity.enabled && data.webauthnCredentials.length > 0
      ? Boolean(
          data.adminSecurity.mfaReverifiedUntil &&
          new Date(data.adminSecurity.mfaReverifiedUntil).getTime() >
            Date.now(),
        )
      : data.isRecentlyVerified;

  const sensitiveDialogConfig = useMemo(
    () =>
      buildSensitiveDialogConfig({
        action: sensitiveAction,
        requireTotp: requireStepUpTotp,
        handlers: data.handlers,
      }),
    [data.handlers, requireStepUpTotp, sensitiveAction],
  );

  const sectionCommonProps: SettingsSectionCommonProps = {
    mode,
    data,
    resolvedUiState,
    navAlpha,
    onNavAlphaChange: handleNavAlphaChange,
    displaySettings,
    onDisplaySettingsChange: handleDisplaySettingsChange,
    onOpenChangePassword: () => setPasswordModalOpen(true),
    onOpenRecoveryCodes: () => setRecoveryModalOpen(true),
    onOpenTotpSetup: () => setTotpSetupModalOpen(true),
    onOpenRestoreVerify: handleOpenRestoreVerify,
    onOpenRetentionSheet: () => setRetentionSheetOpen(true),
    onRequestSensitiveAction: setSensitiveAction,
    onRunBackup: () => void handleRunBackup(),
    onViewFullAuditLog: handleViewFullAuditLog,
    showToast,
  };

  const renderSection = () => {
    if (matchedCardIds !== null) {
      return (
        <LazySearchSection
          {...sectionCommonProps}
          searchQuery={searchQuery}
          matchedCardIds={matchedCardIds}
          onClearSearch={() => setSearchQuery('')}
        />
      );
    }

    switch (activeSection) {
      case 'security':
        return <LazySecuritySection {...sectionCommonProps} />;
      case 'backup':
        return <LazyBackupSection {...sectionCommonProps} />;
      case 'audit':
        return <LazyAuditSection {...sectionCommonProps} />;
      case 'appearance':
        return <LazyAppearanceSection {...sectionCommonProps} />;
      case 'system':
        return <LazySystemSection {...sectionCommonProps} />;
    }
  };

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
        onSelectAccountSection={onAccountSectionNav}
        onSelectTag={onTagNav}
        sidebarCounts={mode === 'live' ? liveSidebar.counts : undefined}
        sidebarTags={mode === 'live' ? liveSidebar.tags : undefined}
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
            onPreloadSection={preloadSettingsSection}
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
          <Suspense
            fallback={
              <LoadingState
                title="正在加载设置模块…"
                description="正在按需载入当前设置分组组件…"
              />
            }
          >
            {renderSection()}
          </Suspense>
        </div>
      </SettingsLayout>

      {mountPasswordModal && (
        <Suspense fallback={null}>
          <LazyChangePasswordModal
            open={passwordModalOpen}
            onOpenChange={setPasswordModalOpen}
            isRecentlyVerified={data.isRecentlyVerified}
            requireStepUpTotp={requireStepUpTotp}
            canUsePasskey={canUsePasskey}
            onPasskeyVerify={data.handlers.passkeyReverify}
            onSubmit={data.handlers.changePassword}
            onSuccess={(msg) =>
              showToast(msg ?? '管理员密码已修改。', 'success')
            }
          />
        </Suspense>
      )}

      {mountRecoveryModal && (
        <Suspense fallback={null}>
          <LazyRecoveryCodesModal
            open={recoveryModalOpen}
            onOpenChange={setRecoveryModalOpen}
            remainingCount={data.totpSecurity.recoveryCodesRemaining}
            totalCount={data.totpSecurity.recoveryCodesTotal}
            onRegenerate={data.handlers.regenerateRecoveryCodes}
            onSuccess={(msg) =>
              showToast(msg ?? '新的备用恢复码已生成，请离线保存。', 'success')
            }
          />
        </Suspense>
      )}

      {mountTotpSetupModal && (
        <Suspense fallback={null}>
          <LazyTotpSetupModal
            open={totpSetupModalOpen}
            onOpenChange={setTotpSetupModalOpen}
            isRebind={data.totpSecurity.enabled}
            isRecentlyVerified={isTotpSetupRecentlyVerified}
            canUsePasskey={canUsePasskey}
            onPasskeyVerify={data.handlers.passkeyReverify}
            onStartSetup={data.handlers.startTotpSetup}
            onConfirmSetup={data.handlers.confirmTotpSetup}
            onSuccess={(msg) =>
              showToast(
                msg ?? 'TOTP 验证器已更新，请妥善保存新恢复码。',
                'success',
              )
            }
          />
        </Suspense>
      )}

      {mountRestoreModal && (
        <Suspense fallback={null}>
          <LazyRestoreVerifyModal
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
                  : (report.errorMessage ??
                      '恢复验证未通过，请排查归档完整性。'),
                report.passed ? 'success' : 'error',
              );
            }}
          />
        </Suspense>
      )}

      {mountRetentionSheet && (
        <Suspense fallback={null}>
          <LazyRetentionPolicySheet
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
        </Suspense>
      )}

      {sensitiveDialogConfig && (
        <Suspense fallback={null}>
          <LazySensitiveActionDialog
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
        </Suspense>
      )}
    </>
  );
}
