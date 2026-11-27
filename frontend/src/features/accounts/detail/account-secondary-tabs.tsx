import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Link2,
  ShieldCheck,
} from 'lucide-react';
import type { AccountDetail, SessionResponse } from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { CredentialForm } from '@/features/auth/credential-form';
import { StepUpVerifier } from '@/features/auth/step-up-verifier';
import { cn } from '@/lib/utils';
import type { ActivityTimelineItem } from './activity-timeline';
import { formatDetailDateTime, maskPhoneNumber } from './detail-mock-fixtures';
import { PASSWORD_MASK_TEXT, usePasswordSecret } from './use-password-secret';
import { useSensitiveFields } from './use-sensitive-fields';

export function SecurityCredentialsTabPanel({
  account,
  secretEpoch,
  session,
  onSession,
  onFailure,
  mockRevealPassword,
  onPasswordAuditEvent,
  onToast,
}: {
  account: AccountDetail;
  secretEpoch: number;
  session?: SessionResponse;
  onSession?: (value: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  mockRevealPassword?: (accountId: string) => Promise<string>;
  onPasswordAuditEvent?: (intent: 'show' | 'copy') => void;
  onToast?: (message: string) => void;
}) {
  const secret = usePasswordSecret({
    accountId: account.id,
    resetEpoch: secretEpoch,
    session,
    onSession,
    onFailure,
    mockReveal: mockRevealPassword,
    onAuditEvent: onPasswordAuditEvent,
    onToast,
  });

  return (
    <GlassPanel
      variant="strong"
      className="space-y-4 rounded-[18px] p-[var(--detail-pad,20px)]"
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--table-divider)] pb-3.5">
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
          <KeyRound className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            安全凭据
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            按需临时解密查看，20 秒后自动清除且不进入全局缓存
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/80 bg-white/60 p-4">
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            Gmail 登录密码（AES-256-GCM 加密存储）
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <output
              aria-label="安全凭据密码"
              className="flex h-10 min-w-0 flex-1 items-center truncate rounded-xl border border-white/85 bg-white/75 px-3 font-mono text-sm"
            >
              {secret.password ?? PASSWORD_MASK_TEXT}
            </output>
            <button
              type="button"
              disabled={secret.pending || Boolean(account.deleted_at)}
              onClick={() => void secret.reveal('show')}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/75 px-3 text-xs font-medium hover:bg-white"
            >
              {secret.password !== null ? (
                <>
                  <EyeOff className="size-3.5" aria-hidden="true" />
                  <span>隐藏</span>
                </>
              ) : (
                <>
                  <Eye className="size-3.5" aria-hidden="true" />
                  <span>显示</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={secret.pending || Boolean(account.deleted_at)}
              onClick={() => void secret.reveal('copy')}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/75 px-3 text-xs font-medium hover:bg-white"
            >
              <Copy className="size-3.5" aria-hidden="true" />
              <span>复制</span>
            </button>
          </div>
          {secret.statusMessage && (
            <p
              role="status"
              className="mt-2 text-xs text-[var(--text-secondary)]"
            >
              {secret.statusMessage}
            </p>
          )}
          {secret.reauth && session && (
            <div className="mt-3 space-y-2.5 rounded-xl border border-[var(--accent)]/25 bg-[var(--surface-popover)] p-3">
              {secret.canUsePasskey && (
                <button
                  type="button"
                  disabled={secret.verifying}
                  onClick={() => void secret.reverifyWithPasskey()}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 text-xs font-medium text-[var(--accent-text)] transition-colors hover:brightness-95 disabled:opacity-50"
                >
                  <KeyRound className="size-3.5" aria-hidden="true" />
                  <span>使用通行密钥（Passkey）验证</span>
                </button>
              )}
              <CredentialForm
                kind="reverify"
                busy={secret.verifying}
                requireStepUpTotp={Boolean(session.step_up_totp_required)}
                onSubmit={(body) => secret.submitReverify(body)}
              />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/60 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="size-4 text-[var(--success)]"
              aria-hidden="true"
            />
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              二步验证与安全时间线
            </p>
          </div>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-secondary)]">二步验证状态</dt>
              <dd
                className={cn(
                  'font-medium',
                  account.two_factor_status === 'enabled'
                    ? 'text-[var(--success-text)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {account.two_factor_status === 'enabled'
                  ? '已启用（TOTP）'
                  : account.two_factor_status === 'disabled'
                    ? '未启用'
                    : '未知'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-secondary)]">上次修改密码</dt>
              <dd className="tabular-nums text-[var(--text-primary)]">
                {formatDetailDateTime(account.password_changed_at)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-secondary)]">最后验证时间</dt>
              <dd className="tabular-nums text-[var(--text-primary)]">
                {formatDetailDateTime(account.last_verified_at)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-secondary)]">最后登录时间</dt>
              <dd className="tabular-nums text-[var(--text-primary)]">
                {formatDetailDateTime(account.last_login_at)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </GlassPanel>
  );
}

export function ContactsTabPanel({
  account,
  secretEpoch = 0,
  session,
  onSession,
  onFailure,
  onCopyField,
}: {
  account: AccountDetail;
  secretEpoch?: number;
  session?: SessionResponse;
  onSession?: (value: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onCopyField: (label: string, value: string) => void;
}) {
  const [showPhone, setShowPhone] = useState(false);
  const hasPhone = Boolean(account.has_phone || account.phone);
  const liveStepUpPhone = Boolean(
    session && account.has_phone && !account.phone,
  );
  const sensitive = useSensitiveFields({
    accountId: account.id,
    resetEpoch: secretEpoch,
    session,
    onSession,
    onFailure,
  });

  // 切换账号或隐藏标签页时必须立即重新遮蔽手机号，防止缓存详情复用导致明文串显。
  useEffect(() => {
    setShowPhone(false);
  }, [account.id]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setShowPhone(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const effectivePhone = liveStepUpPhone
    ? (sensitive.revealed?.phone ?? null)
    : account.phone;
  const isPhoneShown = liveStepUpPhone
    ? Boolean(sensitive.revealed)
    : showPhone;

  return (
    <GlassPanel
      variant="strong"
      className="space-y-4 rounded-[18px] p-[var(--detail-pad,20px)]"
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--table-divider)] pb-3.5">
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
          <Link2 className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            关联账号与联系方式
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">
            辅助恢复渠道与加密存储的绑定手机号
          </p>
        </div>
      </div>

      <dl className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/80 bg-white/60 p-4">
          <dt className="text-xs text-[var(--text-secondary)]">
            辅助邮箱
            {account.recovery_account_id
              ? '（站内关联账号）'
              : account.recovery_email_external
                ? '（外部邮箱）'
                : ''}
          </dt>
          <dd className="mt-2 flex items-center justify-between gap-2 text-sm font-medium text-[var(--text-primary)]">
            <span className="truncate">
              {account.recovery_email || '未配置'}
            </span>
            {account.recovery_email && (
              <button
                type="button"
                aria-label="复制辅助邮箱"
                onClick={() => {
                  if (account.recovery_email) {
                    onCopyField('辅助邮箱', account.recovery_email);
                  }
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2.5 text-xs hover:bg-white"
              >
                <Copy className="size-3.5" aria-hidden="true" />
                <span>复制</span>
              </button>
            )}
          </dd>
        </div>

        <div className="space-y-2 rounded-2xl border border-white/80 bg-white/60 p-4">
          <dt className="text-xs text-[var(--text-secondary)]">绑定手机号</dt>
          <dd className="mt-2 flex items-center justify-between gap-2 text-sm font-medium tabular-nums text-[var(--text-primary)]">
            <span>
              {!hasPhone
                ? '未绑定'
                : liveStepUpPhone
                  ? (effectivePhone ?? '已加密保存（需验证后查看）')
                  : showPhone
                    ? account.phone
                    : maskPhoneNumber(account.phone ?? '')}
            </span>
            {hasPhone && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={sensitive.pending}
                  aria-label={isPhoneShown ? '隐藏手机号' : '显示手机号'}
                  onClick={() => {
                    if (liveStepUpPhone) {
                      if (sensitive.revealed) sensitive.clear();
                      else void sensitive.reveal();
                    } else {
                      setShowPhone((v) => !v);
                    }
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2.5 text-xs hover:bg-white"
                >
                  {isPhoneShown ? '隐藏' : '显示'}
                </button>
                <button
                  type="button"
                  disabled={sensitive.pending}
                  aria-label="复制手机号"
                  onClick={() => {
                    if (liveStepUpPhone) {
                      if (effectivePhone) onCopyField('手机号', effectivePhone);
                      else void sensitive.reveal({ copyPhone: true });
                    } else if (account.phone) {
                      onCopyField('手机号', account.phone);
                    }
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2.5 text-xs hover:bg-white"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  <span>复制</span>
                </button>
              </div>
            )}
          </dd>
          {sensitive.statusMessage && (
            <p role="status" className="text-xs text-[var(--text-secondary)]">
              {sensitive.statusMessage}
            </p>
          )}
          {sensitive.reauth && session && (
            <StepUpVerifier
              session={session}
              requireMfa={Boolean(session.step_up_totp_required)}
              forceVerify
              actionLabel="查看绑定手机号"
              onVerified={sensitive.handleVerified}
              onFailure={onFailure}
            />
          )}
        </div>
      </dl>
    </GlassPanel>
  );
}

export function AuditTabPanel({
  items,
  onOpenGlobalAudit,
}: {
  items: ActivityTimelineItem[];
  onOpenGlobalAudit?: () => void;
}) {
  return (
    <GlassPanel
      variant="strong"
      className="space-y-4 rounded-[18px] p-[var(--detail-pad,20px)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--table-divider)] pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
            <History className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              审计与活动
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              所有资料变更、凭据查看与生命周期操作均记录于防篡改审计链
            </p>
          </div>
        </div>
        {onOpenGlobalAudit && (
          <button
            type="button"
            onClick={onOpenGlobalAudit}
            className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/70 px-3 text-xs font-medium text-[var(--accent-text)] hover:bg-white"
          >
            前往全局审计日志
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">暂无审计记录。</p>
      ) : (
        <ul className="divide-y divide-[var(--table-divider)] text-[13px]">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-medium text-[var(--text-primary)]">
                  {item.title}
                </p>
                {item.source && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    操作来源：{item.source}
                  </p>
                )}
              </div>
              <time className="text-xs tabular-nums text-[var(--text-secondary)]">
                {item.timestamp}
              </time>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

export function BackupsTabPanel({
  account,
  lastBackupLabel,
  backupHealthy = null,
  backupHeadline,
  onOpenBackupPage,
}: {
  account: AccountDetail;
  lastBackupLabel: string;
  backupHealthy?: boolean | null;
  backupHeadline?: string;
  onOpenBackupPage?: () => void;
}) {
  return (
    <GlassPanel
      variant="strong"
      className="space-y-4 rounded-[18px] p-[var(--detail-pad,20px)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--table-divider)] pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
            <Database className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              备份与记录版本
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              展示当前账号的实时乐观锁版本与系统备份状态
            </p>
          </div>
        </div>
        {onOpenBackupPage && (
          <button
            type="button"
            onClick={onOpenBackupPage}
            className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/70 px-3 text-xs font-medium text-[var(--accent-text)] hover:bg-white"
          >
            前往系统备份与恢复
          </button>
        )}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs',
          backupHealthy === true
            ? 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
            : backupHealthy === false
              ? 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]'
              : 'border-[var(--badge-slate-border)] bg-[var(--badge-slate-bg)] text-[var(--badge-slate-text)]',
        )}
      >
        <span className="inline-flex items-center gap-2 font-medium">
          {backupHealthy === true ? (
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            {backupHeadline ??
              (backupHealthy === true
                ? '系统加密备份状态正常'
                : backupHealthy === false
                  ? '系统备份存在告警或尚未完成首次备份'
                  : '等待同步系统备份状态')}
          </span>
        </span>
        <span className="tabular-nums">最近备份：{lastBackupLabel}</span>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/80 bg-white/60 p-4">
          <dt className="text-xs text-[var(--text-secondary)]">
            当前乐观锁版本
          </dt>
          <dd className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--badge-green-text)]">
              v{account.row_version}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              单条记录变更时递增
            </span>
          </dd>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/60 p-4">
          <dt className="text-xs text-[var(--text-secondary)]">最后更新时间</dt>
          <dd className="mt-2 text-sm font-medium tabular-nums text-[var(--text-primary)]">
            {formatDetailDateTime(account.updated_at)}
          </dd>
        </div>
      </dl>
    </GlassPanel>
  );
}
