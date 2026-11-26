import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SettingsCardShell } from './settings-card-shell';
import type { BackupRestoreInfo, CardStateMode } from './types';

export function BackupRestoreCard({
  info,
  running,
  state = 'ready',
  errorText,
  webActionsSupported = true,
  onRunBackup,
  onOpenRestoreVerify,
  onRetry,
}: {
  info: BackupRestoreInfo;
  running: boolean;
  state?: CardStateMode;
  errorText?: string | null;
  webActionsSupported?: boolean;
  onRunBackup: () => void;
  onOpenRestoreVerify: () => void;
  onRetry?: () => void;
}) {
  const isSuccess = info.state === 'success';
  const isFailed = info.state === 'failed';
  const isRunning = running || info.state === 'running';

  return (
    <SettingsCardShell
      id="settings-card-backup-restore"
      title="加密备份与恢复"
      subtitle="PostgreSQL 逻辑快照、age 加密与恢复演练验证"
      icon={<Database className="size-4" />}
      state={state}
      loadingText="正在读取备份状态…"
      errorText={errorText ?? '无法读取加密备份状态，请手动重试。'}
      emptyTitle="尚未产生可用备份"
      emptyDescription="当前尚未配置定时备份或尚未运行首次备份，请先完成备份环境配置后执行备份。"
      onRetry={onRetry}
      headerRight={
        <span
          data-slot="backup-status-pill"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap',
            isRunning
              ? 'border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]'
              : isSuccess
                ? 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
                : isFailed
                  ? 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]'
                  : 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]',
          )}
        >
          {isRunning ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                isSuccess
                  ? 'bg-[var(--success)]'
                  : isFailed
                    ? 'bg-[var(--danger)]'
                    : 'bg-[var(--warning)]',
              )}
            />
          )}
          <span>{isRunning ? '正在备份…' : info.statusLabel}</span>
        </span>
      }
    >
      {isFailed && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3.5 py-2.5 text-[12.5px] leading-5 text-[var(--badge-red-text)]"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            最近一次备份未成功完成，请检查存储空间与 age
            密钥配置后手动重新备份。
          </span>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 rounded-2xl border border-white/75 bg-white/44 p-3.5 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">
            最近备份时间
          </dt>
          <dd
            data-dynamic="timestamp"
            className="mt-0.5 font-medium tabular-nums text-[var(--text-primary)]"
          >
            {info.lastBackupAt ?? '尚未运行'}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">备份方式</dt>
          <dd className="mt-0.5 font-medium text-[var(--text-primary)]">
            {info.method}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[12px] text-[var(--text-secondary)]">备份范围</dt>
          <dd className="mt-0.5 text-[var(--text-primary)]">{info.scope}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">
            最近恢复验证时间
          </dt>
          <dd
            data-dynamic="timestamp"
            className="mt-0.5 tabular-nums text-[var(--text-primary)]"
          >
            {info.lastRestoreVerifiedAt ?? '尚未验证'}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">验证通过</dt>
          <dd className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
            {info.lastRestoreVerifiedAt ? (
              <>
                <CheckCircle2
                  className="size-3.5 shrink-0 text-[var(--success)]"
                  aria-hidden="true"
                />
                <span>{info.restoreVerifySummary}</span>
              </>
            ) : (
              <span className="text-[var(--text-secondary)]">待执行演练</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={isRunning || !webActionsSupported}
          onClick={onRunBackup}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.25)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isRunning ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          <span>{isRunning ? '备份执行中…' : '立即备份'}</span>
        </button>

        <button
          type="button"
          disabled={isRunning || !webActionsSupported}
          onClick={onOpenRestoreVerify}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/72 px-3.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <ShieldCheck
            className="size-3.5 text-[var(--accent)]"
            aria-hidden="true"
          />
          <span>恢复验证…</span>
        </button>
      </div>
      {!webActionsSupported && (
        <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
          当前部署仅通过主机备份脚本与离线恢复演练脚本执行加密备份与校验，Web
          控制台只读展示最新状态文件。
        </p>
      )}
    </SettingsCardShell>
  );
}
