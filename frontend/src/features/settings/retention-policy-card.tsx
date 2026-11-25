import { Clock, SlidersHorizontal } from 'lucide-react';
import { SettingsCardShell } from './settings-card-shell';
import type { CardStateMode, RetentionPolicyInfo } from './types';

export function RetentionPolicyCard({
  policy,
  state = 'ready',
  errorText,
  onAdjustPolicy,
  onRetry,
}: {
  policy: RetentionPolicyInfo;
  state?: CardStateMode;
  errorText?: string | null;
  onAdjustPolicy: () => void;
  onRetry?: () => void;
}) {
  const showStorageMetrics = policy.storageMetricsAvailable !== false;
  const auditPercent = Math.min(100, Math.max(0, policy.auditUsedPercent));
  const backupPercent = Math.min(100, Math.max(0, policy.backupUsedPercent));

  return (
    <SettingsCardShell
      id="settings-card-retention"
      title="日志保留与数据生命周期"
      subtitle="审计合规留存窗口与加密备份自动清理配额"
      icon={<Clock className="size-4" />}
      state={state}
      loadingText="正在读取保留策略与存储占用…"
      errorText={errorText ?? '无法读取日志与备份生命周期策略。'}
      emptyTitle="尚未配置保留策略"
      emptyDescription="请点击“调整策略…”设置审计日志与加密备份的保留周期。"
      onRetry={onRetry}
      headerRight={
        <button
          type="button"
          onClick={onAdjustPolicy}
          className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/85 bg-white/72 px-3 text-[12.5px] font-medium text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/92"
        >
          <SlidersHorizontal
            className="size-3.5 text-[var(--accent)]"
            aria-hidden="true"
          />
          <span>调整策略…</span>
        </button>
      }
    >
      <div className="space-y-3.5">
        {/* 审计日志保留 */}
        <div className="rounded-2xl border border-white/75 bg-white/44 p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-[var(--text-primary)]">
              审计日志保留{' '}
              <strong className="font-semibold tabular-nums">
                {policy.auditRetentionDays} 天
              </strong>
            </span>
            <span className="text-[12.5px] tabular-nums text-[var(--text-secondary)]">
              {showStorageMetrics
                ? `当前占用 ${policy.auditUsedGb.toFixed(2)} GB，${auditPercent}%`
                : '由部署环境变量配置'}
            </span>
          </div>
          {showStorageMetrics && (
            <div
              role="progressbar"
              aria-label="审计日志存储占用比例"
              aria-valuenow={auditPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#1677ff]/14"
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-[220ms] ease-out"
                style={{ width: `${auditPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* 备份文件保留 */}
        <div className="rounded-2xl border border-white/75 bg-white/44 p-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-[var(--text-primary)]">
              备份文件保留{' '}
              <strong className="font-semibold tabular-nums">
                {policy.backupRetentionDays !== null
                  ? `${policy.backupRetentionDays} 天`
                  : '由主机策略管理'}
              </strong>
            </span>
            <span className="text-[12.5px] tabular-nums text-[var(--text-secondary)]">
              {showStorageMetrics
                ? `当前占用 ${policy.backupUsedGb.toFixed(2)} GB，${backupPercent}%`
                : '由备份脚本轮替清理'}
            </span>
          </div>
          {showStorageMetrics && (
            <div
              role="progressbar"
              aria-label="备份文件存储占用比例"
              aria-valuenow={backupPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#1677ff]/14"
            >
              <div
                className="h-full rounded-full bg-[#4d93ff] transition-all duration-[220ms] ease-out"
                style={{ width: `${backupPercent}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
        超期审计日志仅允许冷归档导出，不提供单条篡改；过期加密备份将按周期自动轮替清理。
      </p>
    </SettingsCardShell>
  );
}
