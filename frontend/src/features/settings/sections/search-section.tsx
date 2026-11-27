import { EmptyState } from '@/components/macos';
import { ActiveSessionsCard } from '../active-sessions-card';
import { AdminSecurityCard } from '../admin-security-card';
import { AppearanceCard } from '../appearance-card';
import { AuditLogCard } from '../audit-log-card';
import { BackupRestoreCard } from '../backup-restore-card';
import { RetentionPolicyCard } from '../retention-policy-card';
import { TotpSecurityCard } from '../totp-security-card';
import { WebAuthnSecurityCard } from '../webauthn-security-card';
import { RuntimeStatusCard } from './runtime-status-card';
import type {
  SearchableCardId,
  SettingsSectionCommonProps,
} from './section-shared';

export default function SettingsSearchSection({
  searchQuery,
  matchedCardIds,
  onClearSearch,
  ...props
}: SettingsSectionCommonProps & {
  searchQuery: string;
  matchedCardIds: SearchableCardId[];
  onClearSearch: () => void;
}) {
  const {
    mode,
    data,
    resolvedUiState,
    navAlpha,
    onNavAlphaChange,
    displaySettings,
    onDisplaySettingsChange,
    onOpenChangePassword,
    onOpenRecoveryCodes,
    onOpenTotpSetup,
    onOpenRestoreVerify,
    onOpenRetentionSheet,
    onRequestSensitiveAction,
    onRunBackup,
    onViewFullAuditLog,
    showToast,
  } = props;

  if (matchedCardIds.length === 0) {
    return (
      <EmptyState
        title="未找到匹配的设置项"
        description={`没有与“${searchQuery.trim()}”相关的配置卡片，可尝试搜索“密码”、“TOTP”、“备份”、“审计”或“透明度”。`}
        createLabel="清空搜索条件"
        onCreate={onClearSearch}
      />
    );
  }

  const renderCard = (id: SearchableCardId) => {
    switch (id) {
      case 'admin':
        return (
          <AdminSecurityCard
            key="admin"
            info={data.adminSecurity}
            isRecentlyVerified={data.isRecentlyVerified}
            state={resolvedUiState ?? 'ready'}
            onOpenChangePassword={onOpenChangePassword}
            onOpenReverify={() =>
              onRequestSensitiveAction({ kind: 'reverify' })
            }
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
            onOpenRecoveryCodes={onOpenRecoveryCodes}
            onOpenTotpSetup={onOpenTotpSetup}
            onDisableTotp={() =>
              onRequestSensitiveAction({ kind: 'disable-totp' })
            }
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
                onRequestSensitiveAction({ kind: 'register-webauthn', label });
                return { ok: true };
              }
              const res = await data.handlers.registerWebAuthnCredential(label);
              if (res.ok) {
                showToast(res.message ?? '通行密钥已绑定。', 'success');
              } else if (res.requireReauth) {
                onRequestSensitiveAction({ kind: 'register-webauthn', label });
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
              onRequestSensitiveAction({ kind: 'delete-webauthn', credential })
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
              onRequestSensitiveAction({
                kind: 'terminate-session',
                session: row,
              })
            }
            onLogoutOtherSessions={() =>
              onRequestSensitiveAction({ kind: 'logout-others' })
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
            onRunBackup={onRunBackup}
            onOpenRestoreVerify={() => onOpenRestoreVerify(null)}
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
            maxRows={6}
            expanded={false}
            onViewFullLog={onViewFullAuditLog}
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
            onAdjustPolicy={onOpenRetentionSheet}
            onRetry={data.handlers.retryAll}
          />
        );
      case 'appearance':
        return (
          <AppearanceCard
            key="appearance"
            navAlpha={navAlpha}
            onNavAlphaChange={onNavAlphaChange}
            displaySettings={displaySettings}
            onDisplaySettingsChange={onDisplaySettingsChange}
            showDisplayToggles={true}
          />
        );
      case 'runtime':
        return (
          <RuntimeStatusCard
            key="runtime"
            runtime={data.runtime}
            state={data.runtimeState}
            onOpenRetentionSheet={onOpenRetentionSheet}
            onRetry={data.handlers.retryAll}
          />
        );
    }
  };

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
          onClick={onClearSearch}
          className="font-medium text-[var(--accent)] hover:underline"
        >
          清空搜索
        </button>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {leftCards.map((id) => renderCard(id))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {rightCards.map((id) => renderCard(id))}
        </div>
      </div>
    </div>
  );
}
