/**
 * 账号表单集中业务校验规则：供列表弹窗表单、抽屉编辑与完整详情页共用，避免多入口规则漂移。
 */

export type RecoveryMode = 'none' | 'external' | 'account';

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAccountEmail(email: string): string {
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return email.trim().toLowerCase();
  let [local, domain] = parts;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

export function validatePhoneNumberInput(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 20) {
    return '绑定手机号需包含 6 至 20 位数字。';
  }
  return null;
}

export function validateRecoveryConfiguration({
  gmailEmail,
  mode,
  recoveryEmailExternal,
  recoveryAccountId,
  linkedRecoveryEmail,
}: {
  gmailEmail: string;
  mode: RecoveryMode;
  recoveryEmailExternal: string;
  recoveryAccountId?: string | null;
  linkedRecoveryEmail?: string | null;
}): string | null {
  if (mode === 'none') {
    return null;
  }
  const normalizedPrimary = normalizeAccountEmail(gmailEmail);
  if (mode === 'account') {
    if (
      recoveryAccountId &&
      linkedRecoveryEmail &&
      normalizedPrimary &&
      normalizedPrimary === normalizeAccountEmail(linkedRecoveryEmail)
    ) {
      return '辅助邮箱不能与主邮箱相同';
    }
    return null;
  }
  const trimmedExternal = recoveryEmailExternal.trim();
  if (!trimmedExternal) {
    return null;
  }
  if (!BASIC_EMAIL_RE.test(trimmedExternal)) {
    return '请输入格式有效的辅助邮箱地址';
  }
  if (
    normalizedPrimary &&
    normalizedPrimary === normalizeAccountEmail(trimmedExternal)
  ) {
    return '辅助邮箱不能与主邮箱相同';
  }
  return null;
}

export function resolveDetailRecoverySelection(
  account: {
    recovery_account_id?: string | null;
    recovery_email?: string | null;
  },
  rawInput: string,
): {
  mode: RecoveryMode;
  recovery_account_id: string | null;
  recovery_email_external: string | null;
  linkedRecoveryEmail: string | null;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      mode: 'none',
      recovery_account_id: null,
      recovery_email_external: null,
      linkedRecoveryEmail: null,
    };
  }
  const existingLinkedEmail = (account.recovery_email ?? '').trim();
  if (account.recovery_account_id && trimmed === existingLinkedEmail) {
    return {
      mode: 'account',
      recovery_account_id: account.recovery_account_id,
      recovery_email_external: null,
      linkedRecoveryEmail: existingLinkedEmail,
    };
  }
  return {
    mode: 'external',
    recovery_account_id: null,
    recovery_email_external: trimmed,
    linkedRecoveryEmail: null,
  };
}
