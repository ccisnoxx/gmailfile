import type { ErrorResponse } from '@/api/generated';
import type { AuditLogEntry } from './types';

export type ExtractedErrorInfo = {
  code?: string;
  message: string;
};

export type PrependMockAuditFn = (
  eventType: string,
  eventLabel: string,
  objectType: AuditLogEntry['objectType'],
  objectLabel: string,
  result?: 'success' | 'failed',
) => void;

export function extractErrorInfo(error: unknown): ExtractedErrorInfo {
  const err = error as Partial<ErrorResponse> | null;
  const code = err?.error?.code;
  if (code === 'REAUTH_REQUIRED') {
    return {
      code,
      message: '此高风险操作需要最近重新验证，请输入当前管理员密码后继续。',
    };
  }
  if (code === 'CSRF_INVALID') {
    return {
      code,
      message: '安全令牌已过期，操作未执行且未自动重试，请刷新页面后重试。',
    };
  }
  if (err?.error?.message) {
    return { code, message: err.error.message };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message };
  }
  return { message: '操作失败，请检查服务连接后手动重试（未自动重试）。' };
}

export function isFatalSessionErrorCode(code?: string): boolean {
  return (
    code === 'AUTH_REQUIRED' ||
    code === 'MFA_REQUIRED' ||
    code === 'CSRF_INVALID'
  );
}

export function forwardFatalSessionError(
  error: unknown,
  onFailure?: (error: unknown) => void,
): ExtractedErrorInfo {
  const info = extractErrorInfo(error);
  if (isFatalSessionErrorCode(info.code)) {
    onFailure?.(error);
  }
  return info;
}

export function isReauthActive(
  until?: string | null,
  now = Date.now(),
): boolean {
  if (!until) return false;
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) && parsed > now;
}
