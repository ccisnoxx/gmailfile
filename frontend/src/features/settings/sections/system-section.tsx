import { ActiveSessionsCard } from '../active-sessions-card';
import { BackupRestoreCard } from '../backup-restore-card';
import { RetentionPolicyCard } from '../retention-policy-card';
import { RuntimeStatusCard } from './runtime-status-card';
import type { SettingsSectionCommonProps } from './section-shared';

export default function SystemSettingsSection({
  mode,
  data,
  onOpenRestoreVerify,
  onOpenRetentionSheet,
  onRequestSensitiveAction,
  onRunBackup,
}: SettingsSectionCommonProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <RuntimeStatusCard
          runtime={data.runtime}
          state={data.runtimeState}
          onOpenRetentionSheet={onOpenRetentionSheet}
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
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <RetentionPolicyCard
          policy={data.retention}
          state={data.retentionState}
          errorText={data.retentionError}
          onAdjustPolicy={onOpenRetentionSheet}
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
      </div>
    </div>
  );
}
