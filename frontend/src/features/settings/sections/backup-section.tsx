import { HardDrive, Lock } from 'lucide-react';
import { BackupRestoreCard } from '../backup-restore-card';
import { RetentionPolicyCard } from '../retention-policy-card';
import { SettingsCardShell } from '../settings-card-shell';
import type { SettingsSectionCommonProps } from './section-shared';

export default function BackupSettingsSection({
  mode,
  data,
  onOpenRestoreVerify,
  onOpenRetentionSheet,
  onRunBackup,
}: SettingsSectionCommonProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
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
                  onClick={() => onOpenRestoreVerify(archive.id)}
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
        <RetentionPolicyCard
          policy={data.retention}
          state={data.retentionState}
          errorText={data.retentionError}
          onAdjustPolicy={onOpenRetentionSheet}
          onRetry={data.handlers.retryAll}
        />
        <SettingsCardShell
          title="异地传输与加密基线"
          subtitle="备份链路完整性与密钥隔离约束"
          icon={<Lock className="size-4" />}
        >
          <dl className="space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">异地传输状态</dt>
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
}
