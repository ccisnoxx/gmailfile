import {
  authReverify,
  type ErrorResponse,
  type SessionResponse,
} from '@/api/generated';
import { SensitiveActionDialog } from '@/features/settings/sensitive-action-dialog';
import {
  formatWebAuthnError,
  isWebAuthnSupported,
  performPasskeyStepUp,
} from '@/lib/webauthn';

export default function CsvReauthDialog({
  open,
  session,
  onOpenChange,
  onSessionUpdate,
  onVerified,
}: {
  open: boolean;
  session: SessionResponse;
  onOpenChange: (open: boolean) => void;
  onSessionUpdate: (next: SessionResponse) => void;
  onVerified: () => void;
}) {
  return (
    <SensitiveActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="完成管理员二次验证"
      description="CSV 预览校验与原子导入属于高敏感操作，需验证近期管理员身份。"
      riskSummary="已保留当前内存中的 CSV 文件与字段映射，验证通过后无需重新上传。"
      confirmLabel="验证并继续"
      tone="primary"
      isRecentlyVerified={false}
      alwaysRequireCredentials
      requireTotp={Boolean(
        session.step_up_totp_required && session.totp_enabled,
      )}
      canUsePasskey={Boolean(session.webauthn_enabled && isWebAuthnSupported())}
      onPasskeyVerify={async () => {
        try {
          const updated = await performPasskeyStepUp(session.csrf_token);
          onSessionUpdate(updated);
          return { ok: true, message: '通行密钥验证通过' };
        } catch (error) {
          return { ok: false, error: formatWebAuthnError(error) };
        }
      }}
      onConfirm={async (verify) => {
        if (!verify?.password) {
          return { ok: false, error: '请输入当前管理员密码。' };
        }
        try {
          const { data } = await authReverify({
            body: verify.totpCode
              ? { password: verify.password, totp_code: verify.totpCode }
              : { password: verify.password },
            headers: { 'X-CSRF-Token': session.csrf_token },
            throwOnError: true,
          });
          onSessionUpdate(data);
          return { ok: true, message: '管理员身份验证通过' };
        } catch (error) {
          const err = error as Partial<ErrorResponse> | undefined;
          return {
            ok: false,
            error: err?.error?.message ?? '验证失败，请检查凭据后重试。',
          };
        }
      }}
      onSuccess={onVerified}
    />
  );
}
