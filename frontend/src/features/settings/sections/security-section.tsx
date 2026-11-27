import { ActiveSessionsCard } from '../active-sessions-card';
import { AdminSecurityCard } from '../admin-security-card';
import { AppearanceCard } from '../appearance-card';
import { AuditLogCard } from '../audit-log-card';
import { BackupRestoreCard } from '../backup-restore-card';
import { RetentionPolicyCard } from '../retention-policy-card';
import { TotpSecurityCard } from '../totp-security-card';
import { WebAuthnSecurityCard } from '../webauthn-security-card';
import type { SettingsSectionCommonProps } from './section-shared';

export default function SecuritySettingsSection({
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
}: SettingsSectionCommonProps) {
  return (
    <div
      data-slot="settings-card-grid"
      className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <AdminSecurityCard
          info={data.adminSecurity}
          isRecentlyVerified={data.isRecentlyVerified}
          state={resolvedUiState ?? 'ready'}
          onOpenChangePassword={onOpenChangePassword}
          onOpenReverify={() => onRequestSensitiveAction({ kind: 'reverify' })}
          onRetry={data.handlers.retryAll}
        />
        <ActiveSessionsCard
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
        <AuditLogCard
          entries={data.audits}
          state={data.auditsState}
          errorText={data.auditsError}
          maxRows={6}
          expanded={false}
          onViewFullLog={onViewFullAuditLog}
          onRetry={data.handlers.retryAll}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <TotpSecurityCard
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
        <WebAuthnSecurityCard
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
            const res = await data.handlers.renameWebAuthnCredential(id, label);
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
        <BackupRestoreCard
          info={data.backup}
          running={data.backupRunning}
          state={data.backupState}
          errorText={data.backupError}
          webActionsSupported={mode === 'mock'}
          onRunBackup={onRunBackup}
          onOpenRestoreVerify={() => onOpenRestoreVerify(null)}
          onRetry={data.handlers.retryAll}
        />
        <RetentionPolicyCard
          policy={data.retention}
          state={data.retentionState}
          errorText={data.retentionError}
          onAdjustPolicy={onOpenRetentionSheet}
          onRetry={data.handlers.retryAll}
        />
        <AppearanceCard
          navAlpha={navAlpha}
          onNavAlphaChange={onNavAlphaChange}
          displaySettings={displaySettings}
          onDisplaySettingsChange={onDisplaySettingsChange}
          showDisplayToggles={false}
        />
      </div>
    </div>
  );
}
