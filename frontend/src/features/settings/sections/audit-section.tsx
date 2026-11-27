import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AuditLogCard } from '../audit-log-card';
import { RetentionPolicyCard } from '../retention-policy-card';
import { SettingsCardShell } from '../settings-card-shell';
import type { SettingsSectionCommonProps } from './section-shared';

export default function AuditSettingsSection({
  data,
  onOpenRetentionSheet,
  onViewFullAuditLog,
}: SettingsSectionCommonProps) {
  return (
    <div className="flex flex-col gap-4">
      <AuditLogCard
        entries={data.audits}
        state={data.auditsState}
        errorText={data.auditsError}
        maxRows={20}
        expanded={true}
        onViewFullLog={onViewFullAuditLog}
        onRetry={data.handlers.retryAll}
      />
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
                  <dt className="text-[var(--text-secondary)]">事件总数</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {data.auditIntegrity.totalEvents} 条
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-secondary)]">最新序号</dt>
                  <dd className="mt-0.5 font-mono font-semibold">
                    {data.auditIntegrity.latestSeq != null
                      ? `#${data.auditIntegrity.latestSeq}`
                      : '—'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[var(--text-secondary)]">链尾摘要</dt>
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
        <RetentionPolicyCard
          policy={data.retention}
          state={data.retentionState}
          errorText={data.retentionError}
          onAdjustPolicy={onOpenRetentionSheet}
          onRetry={data.handlers.retryAll}
        />
      </div>
    </div>
  );
}
