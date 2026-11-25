import { useState } from 'react';
import {
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
import type { ActivityTimelineItem } from './activity-timeline';
import { formatDetailDateTime, maskPhoneNumber } from './detail-mock-fixtures';
import { PASSWORD_MASK_TEXT, usePasswordSecret } from './use-password-secret';

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
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
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
            <div className="mt-3 rounded-xl border border-[#1677ff]/25 bg-white/85 p-3">
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
              <dd className="font-medium text-[#1b8a4e]">
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
  onCopyField,
}: {
  account: AccountDetail;
  onCopyField: (label: string, value: string) => void;
}) {
  const [showPhone, setShowPhone] = useState(false);

  return (
    <GlassPanel
      variant="strong"
      className="space-y-4 rounded-[18px] p-[var(--detail-pad,20px)]"
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--table-divider)] pb-3.5">
        <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
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
            辅助邮箱（
            {account.recovery_account_id ? '站内关联账号' : '外部邮箱'}）
          </dt>
          <dd className="mt-2 flex items-center justify-between gap-2 text-sm font-medium text-[var(--text-primary)]">
            <span className="truncate">
              {account.recovery_email || '未配置'}
            </span>
            {account.recovery_email && (
              <button
                type="button"
                onClick={() => onCopyField('辅助邮箱', account.recovery_email)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2.5 text-xs hover:bg-white"
              >
                <Copy className="size-3.5" aria-hidden="true" />
                <span>复制</span>
              </button>
            )}
          </dd>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/60 p-4">
          <dt className="text-xs text-[var(--text-secondary)]">绑定手机号</dt>
          <dd className="mt-2 flex items-center justify-between gap-2 text-sm font-medium tabular-nums text-[var(--text-primary)]">
            <span>
              {account.phone
                ? showPhone
                  ? account.phone
                  : maskPhoneNumber(account.phone)
                : '未绑定'}
            </span>
            {account.phone && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowPhone((v) => !v)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2.5 text-xs hover:bg-white"
                >
                  {showPhone ? '隐藏' : '显示'}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyField('手机号', account.phone!)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2.5 text-xs hover:bg-white"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  <span>复制</span>
                </button>
              </div>
            )}
          </dd>
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
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
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
            className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/70 px-3 text-xs font-medium text-[var(--accent)] hover:bg-white"
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
                <p className="text-xs text-[var(--text-secondary)]">
                  操作来源：{item.source || '管理员（本地控制台）'}
                </p>
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
  onOpenBackupPage,
}: {
  account: AccountDetail;
  lastBackupLabel: string;
  onOpenBackupPage?: () => void;
}) {
  const versions = Array.from(
    { length: Math.min(4, Math.max(1, account.row_version)) },
    (_, i) => account.row_version - i,
  );

  return (
    <GlassPanel
      variant="strong"
      className="space-y-4 rounded-[18px] p-[var(--detail-pad,20px)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--table-divider)] pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
            <Database className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              备份版本
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              乐观锁版本追踪与最近一次加密备份快照
            </p>
          </div>
        </div>
        {onOpenBackupPage && (
          <button
            type="button"
            onClick={onOpenBackupPage}
            className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/70 px-3 text-xs font-medium text-[var(--accent)] hover:bg-white"
          >
            查看系统备份状态
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#2fbf71]/25 bg-[#e7f8ef]/70 px-4 py-3 text-xs text-[#1b8a4e]">
        <span className="inline-flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <span>AES-256-GCM 密文快照已同步</span>
        </span>
        <span className="tabular-nums">最近备份：{lastBackupLabel}</span>
      </div>

      <ul className="divide-y divide-[var(--table-divider)] text-[13px]">
        {versions.map((ver, index) => (
          <li
            key={ver}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center rounded-full border border-[#14b8a6]/28 bg-[#e6f7f2] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#0f8a6c]">
                v{ver}
              </span>
              <span className="font-medium text-[var(--text-primary)]">
                {index === 0 ? '当前活跃版本' : `历史修订快照 #${ver}`}
              </span>
            </div>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">
              {index === 0
                ? formatDetailDateTime(account.updated_at)
                : `已归档校验`}
            </span>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
