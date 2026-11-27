import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  MinusCircle,
  RefreshCw,
  User,
} from 'lucide-react';
import type {
  AccountAppInput,
  AccountDetail,
  RegisteredAppResponse,
  SessionResponse,
} from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AccountAppPill } from '@/features/accounts/account-app-pill';
import {
  AccountAppsEditor,
  type CreateAppHandler,
  type FetchAppIconHandler,
} from '@/features/accounts/account-apps-editor';
import {
  resolveDetailRecoverySelection,
  validatePhoneNumberInput,
  validateRecoveryConfiguration,
} from '@/features/accounts/account-validation';
import type { AppStatus } from '@/features/accounts/constants';
import { CredentialForm } from '@/features/auth/credential-form';
import { StepUpVerifier } from '@/features/auth/step-up-verifier';
import { cn } from '@/lib/utils';
import { maskPhoneNumber } from './detail-mock-fixtures';
import {
  isMaskedPasswordPlaceholder,
  PASSWORD_MASK_TEXT,
  usePasswordSecret,
} from './use-password-secret';
import { useSensitiveFields } from './use-sensitive-fields';

export type AccountBasicInfoDraft = {
  gmail_email: string;
  password: string;
  phone: string;
  clearPhone?: boolean;
  recovery_email_external: string;
  status: AccountDetail['status'];
  two_factor_status: AccountDetail['two_factor_status'];
  purpose: string;
  notes: string;
  clearNotes?: boolean;
  apps: AccountAppInput[];
};

export function createDraftFromAccount(
  account: AccountDetail,
): AccountBasicInfoDraft {
  return {
    gmail_email: account.gmail_email,
    // 编辑模式下密码输入必须为空，绝不回填掩码或原密码。
    password: '',
    phone: account.phone ?? '',
    clearPhone: false,
    recovery_email_external:
      account.recovery_email_external ?? account.recovery_email ?? '',
    status: account.status,
    two_factor_status: account.two_factor_status,
    purpose: account.purpose ?? '',
    notes: account.notes ?? '',
    clearNotes: false,
    apps: (account.apps ?? []).map((item) => ({
      app_id: item.app_id,
      status: item.status,
      note: item.note ?? null,
    })),
  };
}

function serializeAppsDraft(apps: AccountAppInput[]): string {
  return JSON.stringify(
    [...apps]
      .map((item) => ({
        app_id: item.app_id,
        status: item.status ?? 'active',
        note: (item.note ?? '').trim(),
      }))
      .sort((a, b) => a.app_id.localeCompare(b.app_id)),
  );
}

export function isDraftDirty(
  account: AccountDetail,
  draft: AccountBasicInfoDraft,
): boolean {
  const base = createDraftFromAccount(account);
  return (
    draft.gmail_email !== base.gmail_email ||
    draft.password !== '' ||
    draft.phone !== base.phone ||
    Boolean(draft.clearPhone) !== Boolean(base.clearPhone) ||
    draft.recovery_email_external !== base.recovery_email_external ||
    draft.status !== base.status ||
    draft.two_factor_status !== base.two_factor_status ||
    draft.purpose !== base.purpose ||
    draft.notes !== base.notes ||
    Boolean(draft.clearNotes) !== Boolean(base.clearNotes) ||
    serializeAppsDraft(draft.apps) !== serializeAppsDraft(base.apps)
  );
}

const MAX_NOTES_LENGTH = 20000;

const detailStatusOptions: readonly {
  value: AccountDetail['status'];
  label: string;
  dotClass: string;
}[] = [
  { value: 'normal', label: '正常', dotClass: 'bg-[var(--success)]' },
  {
    value: 'pending_verification',
    label: '待验证',
    dotClass: 'bg-[#f5a623]',
  },
  { value: 'restricted', label: '受限', dotClass: 'bg-[var(--warning)]' },
  { value: 'login_failed', label: '无法登录', dotClass: 'bg-[var(--danger)]' },
  { value: 'disabled', label: '停用', dotClass: 'bg-[#98a2b3]' },
  { value: 'archived', label: '已归档', dotClass: 'bg-[#8492a6]' },
];

export function AccountBasicInfoForm({
  account,
  draft,
  isEditing,
  isDirty,
  busy = false,
  conflict = false,
  conflictMessage,
  reauthRequired = false,
  secretEpoch = 0,
  session,
  appsCatalog = [],
  onCreateApp,
  onFetchAppIcon,
  onQuickToggleAppStatus,
  onSession,
  onFailure,
  mockRevealPassword,
  onDraftChange,
  onSubmit,
  onCancel,
  onReloadLatest,
  onCopyField,
  onPasswordAuditEvent,
  onToast,
  className,
}: {
  account: AccountDetail;
  draft: AccountBasicInfoDraft;
  isEditing: boolean;
  isDirty: boolean;
  busy?: boolean;
  conflict?: boolean;
  conflictMessage?: string;
  reauthRequired?: boolean;
  secretEpoch?: number;
  session?: SessionResponse;
  appsCatalog?: RegisteredAppResponse[];
  onCreateApp?: CreateAppHandler;
  onFetchAppIcon?: FetchAppIconHandler;
  onQuickToggleAppStatus?: (
    appId: string,
    nextStatus: AppStatus,
  ) => Promise<void> | void;
  onSession?: (value: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  mockRevealPassword?: (accountId: string) => Promise<string>;
  onDraftChange: (next: AccountBasicInfoDraft) => void;
  onSubmit: (draft: AccountBasicInfoDraft) => Promise<void> | void;
  onCancel: () => void;
  onReloadLatest?: () => void;
  onCopyField: (label: string, value: string) => void;
  onPasswordAuditEvent?: (intent: 'show' | 'copy') => void;
  onToast?: (message: string) => void;
  className?: string;
}) {
  const [phoneVisible, setPhoneVisible] = useState(false);
  const [validationError, setValidationError] = useState('');

  const passwordSecret = usePasswordSecret({
    accountId: account.id,
    resetEpoch: secretEpoch + (isEditing ? 10000 : 0),
    session,
    onSession,
    onFailure,
    mockReveal: mockRevealPassword,
    onAuditEvent: onPasswordAuditEvent,
    onToast,
  });

  const sensitiveFields = useSensitiveFields({
    accountId: account.id,
    resetEpoch: secretEpoch + (isEditing ? 10000 : 0),
    session,
    onSession,
    onFailure,
    onToast,
  });

  // 切换账号、进入编辑或隐藏标签页时，自动重新遮蔽手机号并清空表单校验错误
  useEffect(() => {
    setPhoneVisible(false);
    setValidationError('');
  }, [account.id, isEditing]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPhoneVisible(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const currentStatusMeta =
    detailStatusOptions.find((item) => item.value === draft.status) ??
    detailStatusOptions[0];

  const handleFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isEditing || busy || conflict) return;

    setValidationError('');

    if (!draft.gmail_email.trim()) {
      setValidationError('请填写 Gmail 地址。');
      return;
    }

    if (isMaskedPasswordPlaceholder(draft.password)) {
      setValidationError(
        '不允许将密码掩码占位文本作为真实密码提交；若不修改密码请保持留空。',
      );
      return;
    }

    const phoneError = validatePhoneNumberInput(draft.phone);
    if (phoneError) {
      setValidationError(phoneError);
      return;
    }

    const recoverySelection = resolveDetailRecoverySelection(
      account,
      draft.recovery_email_external,
    );
    const recoveryError = validateRecoveryConfiguration({
      gmailEmail: draft.gmail_email,
      mode: recoverySelection.mode,
      recoveryEmailExternal: draft.recovery_email_external,
      recoveryAccountId: recoverySelection.recovery_account_id,
      linkedRecoveryEmail: recoverySelection.linkedRecoveryEmail,
    });
    if (recoveryError) {
      setValidationError(recoveryError);
      return;
    }

    await onSubmit({
      ...draft,
      gmail_email: draft.gmail_email.trim(),
      recovery_email_external: draft.recovery_email_external.trim(),
      phone: draft.phone.trim(),
      purpose: draft.purpose.trim(),
      notes: draft.notes,
    });
  };

  const glassActionButtonClass =
    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/85 bg-white/70 px-3 text-xs font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(45,86,138,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-[160ms] ease-out hover:bg-white/95 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50';

  const fieldBoxClass = cn(
    'h-10 w-full rounded-xl border px-3 text-[13.5px] text-[var(--text-primary)] transition-all duration-[160ms] ease-out outline-none',
    isEditing
      ? 'border-[#b9d3f2] bg-white/88 shadow-[inset_0_1px_2px_rgba(32,68,118,0.04)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#1677ff]/20'
      : 'border-white/82 bg-white/58 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]',
  );

  const labelClass =
    'text-[13px] font-medium text-[var(--text-secondary)] sm:pt-2';

  const hasPhone = Boolean(account.has_phone || account.phone);
  const encryptedPhoneHidden = Boolean(account.has_phone && !account.phone);
  const encryptedNotesHidden = Boolean(account.has_notes && !account.notes);
  const liveStepUpPhone = Boolean(session && encryptedPhoneHidden);
  const liveStepUpNotes = Boolean(session && encryptedNotesHidden);
  const effectivePhone = liveStepUpPhone
    ? (sensitiveFields.revealed?.phone ?? null)
    : account.phone;
  const phoneDisplayValue = !hasPhone
    ? '未绑定'
    : liveStepUpPhone
      ? (effectivePhone ?? '已加密保存（需验证后查看）')
      : phoneVisible
        ? (account.phone ?? '未绑定')
        : maskPhoneNumber(account.phone ?? '');
  const isPhoneCurrentlyShown = liveStepUpPhone
    ? Boolean(sensitiveFields.revealed)
    : phoneVisible;

  const fieldsBody = (
    <>
      <div className="flex-1 space-y-3.5 p-[var(--detail-pad,20px)]">
        {/* 版本冲突警告条 */}
        {conflict && (
          <Alert
            variant="destructive"
            role="alert"
            className="rounded-2xl border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]"
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>
                {conflictMessage ||
                  `版本冲突：账号已被其他页面更新（当前基于 v${account.row_version}），为避免静默覆盖已禁用保存。`}
              </span>
              {onReloadLatest && (
                <button
                  type="button"
                  onClick={onReloadLatest}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-current/35 bg-white/90 px-2.5 text-xs font-medium text-[var(--danger-text)] transition-colors hover:bg-white"
                >
                  <RefreshCw className="size-3" aria-hidden="true" />
                  <span>重新加载最新版本</span>
                </button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* 表单校验提示 */}
        {validationError && (
          <Alert
            variant="destructive"
            role="alert"
            className="rounded-2xl border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]"
          >
            <AlertDescription className="text-xs">
              {validationError}
            </AlertDescription>
          </Alert>
        )}

        {/* 1. Gmail 地址 */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-center sm:gap-2.5">
          <label htmlFor="detail-gmail-email" className={labelClass}>
            Gmail 地址
          </label>
          <div className="relative flex min-w-0 items-center">
            <input
              id="detail-gmail-email"
              name="gmail_email"
              type="email"
              required
              readOnly={!isEditing}
              maxLength={254}
              autoComplete="off"
              value={draft.gmail_email}
              onChange={(e) =>
                onDraftChange({ ...draft, gmail_email: e.target.value })
              }
              className={cn(fieldBoxClass, !isEditing && 'pr-10')}
            />
            {!isEditing && (
              <button
                type="button"
                aria-label="复制 Gmail 地址"
                title="复制 Gmail 地址"
                onClick={() => onCopyField('Gmail 地址', account.gmail_email)}
                className="absolute right-2 inline-flex size-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/80 hover:text-[var(--accent)]"
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* 2. 登录密码 */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-start sm:gap-2.5">
          <label htmlFor="detail-password" className={labelClass}>
            登录密码
          </label>
          <div className="min-w-0 space-y-2">
            {isEditing ? (
              <div>
                <input
                  id="detail-password"
                  name="password"
                  type="password"
                  maxLength={1024}
                  autoComplete="new-password"
                  placeholder="留空保留原密码，仅需修改时输入新密码"
                  value={draft.password}
                  onChange={(e) => {
                    setValidationError('');
                    onDraftChange({ ...draft, password: e.target.value });
                  }}
                  className={fieldBoxClass}
                />
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  不会自动回填原密码或掩码占位符；留空保存将保留现有加密密码。
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-10 min-w-[140px] flex-1 items-center rounded-xl border border-white/82 bg-white/58 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <output
                    id="detail-password"
                    aria-label="登录密码"
                    className={cn(
                      'truncate text-[13.5px] tracking-wider text-[var(--text-primary)]',
                      passwordSecret.password !== null
                        ? 'font-mono tracking-normal'
                        : 'select-none',
                    )}
                  >
                    {passwordSecret.password ?? PASSWORD_MASK_TEXT}
                  </output>
                </div>

                <button
                  type="button"
                  disabled={
                    passwordSecret.pending || Boolean(account.deleted_at)
                  }
                  aria-label={
                    passwordSecret.password !== null ? '隐藏密码' : '显示密码'
                  }
                  onClick={() => void passwordSecret.reveal('show')}
                  className={glassActionButtonClass}
                >
                  {passwordSecret.password !== null ? (
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
                  disabled={
                    passwordSecret.pending || Boolean(account.deleted_at)
                  }
                  aria-label="复制密码"
                  onClick={() => void passwordSecret.reveal('copy')}
                  className={glassActionButtonClass}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  <span>复制</span>
                </button>
              </div>
            )}

            {!isEditing && passwordSecret.statusMessage && (
              <p
                role="status"
                className="text-[11.5px] text-[var(--text-secondary)]"
              >
                {passwordSecret.statusMessage}
              </p>
            )}

            {!isEditing && passwordSecret.reauth && session && (
              <div className="space-y-2.5 rounded-2xl border border-[var(--accent)]/25 bg-[var(--surface-popover)] p-3.5 shadow-sm">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  {session.step_up_totp_required
                    ? '需要最近 5 分钟内的二次验证（通行密钥或管理员密码 + TOTP）后方可查看凭据。'
                    : '需要完成管理员重新验证后方可查看凭据。'}
                </p>
                {passwordSecret.canUsePasskey && (
                  <button
                    type="button"
                    disabled={passwordSecret.verifying}
                    onClick={() => void passwordSecret.reverifyWithPasskey()}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 text-xs font-medium text-[var(--accent-text)] transition-colors hover:brightness-95 disabled:opacity-50"
                  >
                    <KeyRound className="size-3.5" aria-hidden="true" />
                    <span>使用通行密钥（Passkey）验证</span>
                  </button>
                )}
                <CredentialForm
                  kind="reverify"
                  busy={passwordSecret.verifying}
                  requireStepUpTotp={Boolean(session.step_up_totp_required)}
                  onSubmit={(body) => passwordSecret.submitReverify(body)}
                />
              </div>
            )}
          </div>
        </div>

        {/* 3. 手机号 */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-center sm:gap-2.5">
          <label htmlFor="detail-phone" className={labelClass}>
            手机号
          </label>
          {isEditing ? (
            <div className="space-y-1.5">
              <input
                id="detail-phone"
                name="phone"
                type="tel"
                maxLength={32}
                pattern={String.raw`\+?[0-9 \(\)\-]{5,31}`}
                autoComplete="off"
                disabled={Boolean(draft.clearPhone)}
                placeholder={
                  encryptedPhoneHidden
                    ? '已加密保存（留空保留原值，输入新手机号将覆盖）'
                    : '例如：+86 139 8420 6728'
                }
                value={draft.phone}
                onChange={(e) =>
                  onDraftChange({ ...draft, phone: e.target.value })
                }
                className={fieldBoxClass}
              />
              {encryptedPhoneHidden && (
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.clearPhone)}
                    onChange={(e) =>
                      onDraftChange({
                        ...draft,
                        clearPhone: e.target.checked,
                        phone: e.target.checked ? '' : draft.phone,
                      })
                    }
                  />
                  清空已保存的手机号
                </label>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-10 min-w-[140px] flex-1 items-center rounded-xl border border-white/82 bg-white/58 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <output
                    id="detail-phone"
                    aria-label="手机号"
                    className="truncate text-[13.5px] tabular-nums text-[var(--text-primary)]"
                  >
                    {phoneDisplayValue}
                  </output>
                </div>
                <button
                  type="button"
                  disabled={!hasPhone || sensitiveFields.pending}
                  aria-label={
                    isPhoneCurrentlyShown ? '隐藏手机号' : '显示手机号'
                  }
                  onClick={() => {
                    if (liveStepUpPhone) {
                      if (sensitiveFields.revealed) {
                        sensitiveFields.clear();
                      } else {
                        void sensitiveFields.reveal();
                      }
                    } else {
                      setPhoneVisible((visible) => !visible);
                    }
                  }}
                  className={glassActionButtonClass}
                >
                  {isPhoneCurrentlyShown ? (
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
                  disabled={!hasPhone || sensitiveFields.pending}
                  aria-label="复制手机号"
                  onClick={() => {
                    if (liveStepUpPhone) {
                      if (effectivePhone) {
                        onCopyField('手机号', effectivePhone);
                      } else {
                        void sensitiveFields.reveal({ copyPhone: true });
                      }
                    } else if (account.phone) {
                      onCopyField('手机号', account.phone);
                    }
                  }}
                  className={glassActionButtonClass}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  <span>复制</span>
                </button>
              </div>
              {sensitiveFields.statusMessage && (
                <p
                  role="status"
                  className="text-xs text-[var(--text-secondary)]"
                >
                  {sensitiveFields.statusMessage}
                </p>
              )}
              {sensitiveFields.reauth && session && (
                <StepUpVerifier
                  session={session}
                  requireMfa={Boolean(session.step_up_totp_required)}
                  forceVerify
                  actionLabel="查看手机号与备注"
                  onVerified={sensitiveFields.handleVerified}
                  onFailure={onFailure}
                />
              )}
            </div>
          )}
        </div>

        {/* 4. 辅助邮箱 */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-center sm:gap-2.5">
          <label htmlFor="detail-recovery-email" className={labelClass}>
            辅助邮箱
          </label>
          <div className="relative flex min-w-0 items-center">
            <input
              id="detail-recovery-email"
              name="recovery_email_external"
              type="email"
              readOnly={!isEditing}
              maxLength={254}
              autoComplete="off"
              placeholder={
                isEditing ? '可选：留空表示暂不设置辅助邮箱' : '未填写辅助邮箱'
              }
              value={draft.recovery_email_external}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  recovery_email_external: e.target.value,
                })
              }
              className={cn(fieldBoxClass, !isEditing && 'pr-10')}
            />
            {!isEditing && account.recovery_email && (
              <button
                type="button"
                aria-label="复制辅助邮箱"
                title="复制辅助邮箱"
                onClick={() => {
                  if (account.recovery_email) {
                    onCopyField('辅助邮箱', account.recovery_email);
                  }
                }}
                className="absolute right-2 inline-flex size-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/80 hover:text-[var(--accent)]"
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* 5. 账号状态 + 二步验证（2FA） */}
        <div className="grid gap-2.5 sm:grid-cols-[80px_1fr] sm:items-center">
          <label htmlFor="detail-status" className={labelClass}>
            账号状态
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* 状态下拉选择器（只读态用纯展示胶囊避免原生箭头，编辑态用原生 select） */}
            {isEditing ? (
              <div className="relative flex w-[118px] shrink-0 items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute left-3 size-2 rounded-full',
                    currentStatusMeta.dotClass,
                  )}
                />
                <select
                  id="detail-status"
                  name="status"
                  value={draft.status}
                  style={{
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                  }}
                  onChange={(e) =>
                    onDraftChange({
                      ...draft,
                      status: e.target.value as AccountDetail['status'],
                    })
                  }
                  className={cn(
                    fieldBoxClass,
                    'macos-select appearance-none pr-7 pl-7 font-medium',
                  )}
                >
                  {detailStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2.5 size-4 text-[var(--text-secondary)]"
                />
              </div>
            ) : (
              <output
                id="detail-status"
                aria-label="账号状态"
                className="flex h-10 w-[118px] shrink-0 items-center gap-2 rounded-xl border border-white/82 bg-white/58 px-3 text-[13.5px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    currentStatusMeta.dotClass,
                  )}
                />
                <span>{currentStatusMeta.label}</span>
              </output>
            )}

            <div className="flex min-w-0 flex-1 basis-[228px] items-center gap-2">
              <label
                htmlFor="detail-two-factor"
                className="shrink-0 text-[12.5px] font-medium whitespace-nowrap text-[var(--text-secondary)]"
              >
                二步验证（2FA）
              </label>

              {/* 2FA 只读胶囊或编辑下拉 */}
              {isEditing ? (
                <div className="relative flex min-w-0 flex-1 items-center">
                  <select
                    id="detail-two-factor"
                    name="two_factor_status"
                    value={draft.two_factor_status}
                    style={{
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                    }}
                    onChange={(e) =>
                      onDraftChange({
                        ...draft,
                        two_factor_status: e.target
                          .value as AccountDetail['two_factor_status'],
                      })
                    }
                    className={cn(
                      fieldBoxClass,
                      'macos-select appearance-none pr-7 pl-2.5 text-[12.5px]',
                    )}
                  >
                    <option value="enabled">已启用（TOTP）</option>
                    <option value="disabled">未启用</option>
                    <option value="unknown">未知</option>
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 size-4 text-[var(--text-secondary)]"
                  />
                </div>
              ) : (
                <output
                  id="detail-two-factor"
                  aria-label="二步验证（2FA）"
                  className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-white/82 bg-white/58 px-2.5 text-[12.5px] font-medium whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
                >
                  {account.two_factor_status === 'enabled' ? (
                    <>
                      <CheckCircle2
                        className="size-4 shrink-0 text-[var(--success)]"
                        aria-hidden="true"
                      />
                      <span className="truncate text-[var(--success-text)]">
                        已启用（TOTP）
                      </span>
                    </>
                  ) : account.two_factor_status === 'disabled' ? (
                    <>
                      <MinusCircle
                        className="size-4 shrink-0 text-[#98a2b3]"
                        aria-hidden="true"
                      />
                      <span className="text-[var(--text-secondary)]">
                        未启用
                      </span>
                    </>
                  ) : (
                    <>
                      <HelpCircle
                        className="size-4 shrink-0 text-[#98a2b3]"
                        aria-hidden="true"
                      />
                      <span className="text-[var(--text-secondary)]">未知</span>
                    </>
                  )}
                </output>
              )}
            </div>
          </div>
        </div>

        {/* 6. 用途 */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-center sm:gap-2.5">
          <label htmlFor="detail-purpose" className={labelClass}>
            用途
          </label>
          <input
            id="detail-purpose"
            name="purpose"
            type="text"
            readOnly={!isEditing}
            maxLength={100}
            placeholder="填写账号用途与所属场景"
            value={draft.purpose}
            onChange={(e) =>
              onDraftChange({ ...draft, purpose: e.target.value })
            }
            className={fieldBoxClass}
          />
        </div>

        {/* 6.5 已注册应用与封禁状态 */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-start sm:gap-2.5">
          <span className={labelClass}>已注册应用</span>
          <div className="min-w-0">
            {isEditing ? (
              <AccountAppsEditor
                catalog={appsCatalog}
                value={draft.apps}
                onChange={(nextApps) =>
                  onDraftChange({ ...draft, apps: nextApps })
                }
                onCreateApp={onCreateApp}
                onFetchAppIcon={onFetchAppIcon}
                disabled={busy || conflict}
              />
            ) : account.apps && account.apps.length > 0 ? (
              <div className="space-y-2">
                <ul className="space-y-2" aria-label="已注册应用">
                  {account.apps.map((app) => (
                    <li
                      key={app.app_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/82 bg-white/58 px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <AccountAppPill app={app} />
                        {app.note && (
                          <span className="truncate text-xs text-[var(--text-secondary)]">
                            {app.note}
                          </span>
                        )}
                      </div>
                      {!account.deleted_at && onQuickToggleAppStatus && (
                        <div className="flex shrink-0 items-center gap-1">
                          {app.status !== 'banned' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void onQuickToggleAppStatus(
                                  app.app_id,
                                  'banned',
                                )
                              }
                              className="inline-flex h-7 items-center rounded-lg border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-2 text-[11.5px] font-medium text-[var(--badge-red-text)] transition-opacity hover:opacity-85 disabled:opacity-50"
                            >
                              标为已封禁
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void onQuickToggleAppStatus(
                                  app.app_id,
                                  'active',
                                )
                              }
                              className="inline-flex h-7 items-center rounded-lg border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-2 text-[11.5px] font-medium text-[var(--badge-green-text)] transition-opacity hover:opacity-85 disabled:opacity-50"
                            >
                              恢复正常
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex h-10 items-center rounded-xl border border-white/82 bg-white/58 px-3 text-[13px] text-[var(--text-secondary)]">
                暂未记录已注册应用（点击右上角「编辑」可添加）
              </p>
            )}
          </div>
        </div>

        {/* 7. 备注（支持按需二次验证查看，编辑留空不覆盖原密文） */}
        <div className="grid gap-1.5 sm:grid-cols-[80px_1fr] sm:items-start sm:gap-2.5">
          <label htmlFor="detail-notes" className={labelClass}>
            备注
          </label>
          <div className="space-y-2">
            {!isEditing && liveStepUpNotes && !sensitiveFields.revealed ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/82 bg-white/58 px-3 py-3 text-[13px] text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <span>已加密保存（需管理员重新验证后查看，20 秒自动隐藏）</span>
                <button
                  type="button"
                  disabled={sensitiveFields.pending}
                  onClick={() => void sensitiveFields.reveal()}
                  className={glassActionButtonClass}
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  <span>
                    {sensitiveFields.pending ? '正在加载…' : '查看敏感备注'}
                  </span>
                </button>
              </div>
            ) : (
              <div className="relative">
                <textarea
                  id="detail-notes"
                  name="notes"
                  rows={4}
                  readOnly={!isEditing}
                  disabled={isEditing && Boolean(draft.clearNotes)}
                  maxLength={MAX_NOTES_LENGTH}
                  placeholder={
                    isEditing && encryptedNotesHidden
                      ? '已加密保存（留空保留原值，输入新内容将覆盖）'
                      : '填写使用说明、授权边界与注意事项…'
                  }
                  value={
                    !isEditing && liveStepUpNotes
                      ? (sensitiveFields.revealed?.notes ?? '')
                      : draft.notes
                  }
                  onChange={(e) =>
                    onDraftChange({
                      ...draft,
                      notes: e.target.value.slice(0, MAX_NOTES_LENGTH),
                    })
                  }
                  className={cn(
                    'w-full resize-none rounded-xl border px-3 pt-2.5 pb-7 text-[13.5px] leading-relaxed text-[var(--text-primary)] transition-all duration-[160ms] ease-out outline-none',
                    isEditing
                      ? 'border-[#b9d3f2] bg-white/88 shadow-[inset_0_1px_2px_rgba(32,68,118,0.04)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#1677ff]/20'
                      : 'border-white/82 bg-white/58 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]',
                  )}
                />
                <span
                  data-slot="notes-char-count"
                  className="pointer-events-none absolute right-3 bottom-2 text-[11.5px] tabular-nums text-[var(--text-secondary)]"
                >
                  {!isEditing && liveStepUpNotes
                    ? (sensitiveFields.revealed?.notes ?? '').length
                    : draft.notes.length}{' '}
                  / {MAX_NOTES_LENGTH}
                </span>
              </div>
            )}
            {!isEditing && liveStepUpNotes && sensitiveFields.revealed && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={sensitiveFields.clear}
                  className={glassActionButtonClass}
                >
                  <EyeOff className="size-3.5" aria-hidden="true" />
                  <span>立即隐藏敏感资料</span>
                </button>
              </div>
            )}
            {isEditing && encryptedNotesHidden && (
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={Boolean(draft.clearNotes)}
                  onChange={(e) =>
                    onDraftChange({
                      ...draft,
                      clearNotes: e.target.checked,
                      notes: e.target.checked ? '' : draft.notes,
                    })
                  }
                />
                清空已保存的敏感备注
              </label>
            )}
          </div>
        </div>

        {isEditing && reauthRequired && session && (
          <StepUpVerifier
            session={session}
            requireMfa={Boolean(session.step_up_totp_required)}
            forceVerify
            disabled={busy}
            actionLabel="保存密码修改"
            onVerified={(next) => onSession?.(next)}
            onFailure={onFailure}
          />
        )}
      </div>

      {/* 编辑模式底部固定保存 / 取消操作条 */}
      {isEditing && (
        <div
          data-slot="edit-sticky-actions"
          className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-[18px] border-t border-[var(--table-divider)] bg-[var(--surface-sticky-cell)] px-[var(--detail-pad,20px)] py-3 backdrop-blur-md"
        >
          <p className="text-xs text-[var(--text-secondary)]">
            {isDirty
              ? `有未保存修改 · 基于 v${account.row_version}`
              : `未修改字段 · 按 Esc 退出编辑`}
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/85 bg-white/75 px-4 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(45,86,138,0.06)] transition-all duration-[160ms] ease-out hover:bg-white"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy || conflict}
              className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.28)] transition-all duration-[160ms] ease-out hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '正在保存…' : '保存修改'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <GlassPanel
      variant="strong"
      data-slot="account-basic-info-form"
      className={cn(
        'relative flex min-w-0 flex-col overflow-clip rounded-[18px]',
        className,
      )}
    >
      {/* 标题区 */}
      <div className="flex items-start justify-between gap-3 border-b border-[var(--table-divider)] px-[var(--detail-pad,20px)] pt-[var(--detail-pad,20px)] pb-3.5">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"
          >
            <User className="size-4" />
          </span>
          <div>
            <h2 className="text-[16px] leading-snug font-semibold tracking-tight text-[var(--text-primary)]">
              基本信息
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              账号的核心资料与使用说明
            </p>
          </div>
        </div>
        {isEditing && (
          <span className="inline-flex items-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-text)]">
            编辑模式
          </span>
        )}
      </div>

      {/* 仅在编辑态使用外层 <form>，避免查看态内嵌重新验证 <CredentialForm> 形成非法嵌套表单 */}
      {isEditing ? (
        <form
          aria-label="基本信息表单"
          onSubmit={(e) => void handleFormSubmit(e)}
          className="flex flex-1 flex-col"
        >
          {fieldsBody}
        </form>
      ) : (
        <div aria-label="基本信息表单" className="flex flex-1 flex-col">
          {fieldsBody}
        </div>
      )}
    </GlassPanel>
  );
}
