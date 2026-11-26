import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  KeyRound,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  authReverify,
  encryptedExport,
  type AccountQuery,
  type ErrorResponse,
  type SessionResponse,
} from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { accountQuery } from '@/features/accounts/query-state';
import {
  formatWebAuthnError,
  isWebAuthnSupported,
  performPasskeyStepUp,
} from '@/lib/webauthn';

function isUntilActive(until?: string | null, nowMs = Date.now()): boolean {
  if (!until) return false;
  const ms = Date.parse(until);
  return Number.isFinite(ms) && ms > nowMs;
}

function triggerDownload(blob: Blob, filename: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractFailureMessage(error: unknown, isEncrypted = false): string {
  const err = error as Partial<ErrorResponse> | undefined;
  const code = err?.error?.code;
  if (code === 'REAUTH_REQUIRED') {
    return isEncrypted
      ? '二次验证已过期，请先完成 Passkey 或管理员密码 + TOTP 验证。'
      : '请重新验证后再尝试导出。';
  }
  if (err?.error?.message) return err.error.message;
  return '导出失败，请检查网络连接与服务状态后重试。';
}

export function DataExportPanel({
  mode,
  session,
  exportBusy,
  onSession,
  onFailure,
  onExportCsv,
  onToast,
}: {
  mode: 'live' | 'mock';
  session?: SessionResponse;
  exportBusy: boolean;
  onSession?: (next: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onExportCsv: (scope: 'all' | 'filtered', filters?: AccountQuery) => Promise<void>;
  onToast?: (message: string) => void;
}) {
  const isMock = mode === 'mock' || !session;
  const idPrefix = useId();
  const alive = useRef(true);

  const [csvScope, setCsvScope] = useState<'all' | 'filtered'>('all');
  const [encScope, setEncScope] = useState<'all' | 'filtered'>('all');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [encBusy, setEncBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [encError, setEncError] = useState('');
  const [encMessage, setEncMessage] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [latestSession, setLatestSession] = useState<SessionResponse | undefined>(
    session,
  );

  useEffect(() => {
    setLatestSession(session);
  }, [session]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    alive.current = true;
    const clearSecrets = () => {
      if (document.hidden) {
        setPassphrase('');
        setPassphraseConfirm('');
        setAdminPassword('');
        setTotpCode('');
      }
    };
    document.addEventListener('visibilitychange', clearSecrets);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', clearSecrets);
    };
  }, []);

  const currentSearch =
    typeof window !== 'undefined' ? window.location.search : '';
  const filters = accountQuery(new URLSearchParams(currentSearch));

  const hasMfaStepUp = Boolean(
    latestSession &&
      isUntilActive(latestSession.reauthenticated_until, nowMs) &&
      isUntilActive(latestSession.mfa_reauthenticated_until, nowMs),
  );
  const canPasskeyStepUp = Boolean(
    latestSession?.webauthn_enabled && isWebAuthnSupported(),
  );
  const totpEnabled = latestSession?.totp_enabled !== false;

  async function handlePasskeyStepUp() {
    if (!latestSession || passkeyBusy || encBusy) return;
    setEncError('');
    setEncMessage('');
    setPasskeyBusy(true);
    try {
      const updated = await performPasskeyStepUp(latestSession.csrf_token);
      if (!alive.current || document.hidden) return;
      setLatestSession(updated);
      setNowMs(Date.now());
      onSession?.(updated);
      setEncMessage(
        '通行密钥 Step-Up 验证成功（5 分钟内有效），现在可填写加密口令并下载。',
      );
      onToast?.('通行密钥二次验证通过。');
    } catch (error) {
      if (alive.current) {
        setEncError(formatWebAuthnError(error));
        onFailure?.(error);
      }
    } finally {
      if (alive.current) setPasskeyBusy(false);
    }
  }

  async function handleEncryptedSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isMock || !latestSession || encBusy) return;
    setEncError('');
    setEncMessage('');

    if (passphrase.length < 16) {
      setEncError('导出加密口令至少需要 16 位字符，建议使用多词短语。');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setEncError('两次输入的导出加密口令不一致。');
      return;
    }

    const freshNow = Date.now();
    const stepUpStillValid =
      isUntilActive(latestSession.reauthenticated_until, freshNow) &&
      isUntilActive(latestSession.mfa_reauthenticated_until, freshNow);

    if (!stepUpStillValid && !totpEnabled) {
      setEncError(
        canPasskeyStepUp
          ? '当前管理员未启用 TOTP，请先点击上方“使用通行密钥完成 Step-Up”按钮后再导出。'
          : '加密导出要求双因素二次验证，请先前往「系统设置 → 安全与认证」绑定 TOTP 验证器或通行密钥。',
      );
      return;
    }

    const secretPassphrase = passphrase;
    const stepUpPassword = adminPassword;
    const stepUpTotp = totpCode.trim();
    // 立即清空敏感输入，缩短明文内存驻留窗口
    setPassphrase('');
    setPassphraseConfirm('');
    setAdminPassword('');
    setTotpCode('');

    setEncBusy(true);
    try {
      let csrfToken = latestSession.csrf_token;
      if (!stepUpStillValid) {
        if (!stepUpPassword || !/^\d{6}$/.test(stepUpTotp)) {
          setEncError(
            '加密导出必须先完成管理员密码与 6 位 TOTP 验证码二次验证。',
          );
          return;
        }
        const reauth = await authReverify({
          body: { password: stepUpPassword, totp_code: stepUpTotp },
          headers: { 'X-CSRF-Token': csrfToken },
          throwOnError: true,
        });
        csrfToken = reauth.data.csrf_token;
        if (alive.current) {
          setLatestSession(reauth.data);
          setNowMs(Date.now());
          onSession?.(reauth.data);
        }
      }

      const result = await encryptedExport({
        body:
          encScope === 'all'
            ? { scope: encScope, passphrase: secretPassphrase }
            : {
                scope: encScope,
                filters: filters as AccountQuery,
                passphrase: secretPassphrase,
              },
        headers: { 'X-CSRF-Token': csrfToken },
        parseAs: 'blob',
        throwOnError: true,
      });

      if (!alive.current || document.hidden) return;
      const filename =
        /filename="([^"]+)"/.exec(
          result.response.headers.get('Content-Disposition') || '',
        )?.[1] || 'gmail-accounts-encrypted.gmenc';
      triggerDownload(result.data, filename);
      setEncMessage(
        `加密导出包（${filename}）已开始下载。离线解密命令：python -m app.cli decrypt-export --input <文件.gmenc> --output <输出.csv>`,
      );
      onToast?.(`流式加密导出包（${filename}）已开始下载。`);
    } catch (error) {
      if (alive.current) {
        setEncError(extractFailureMessage(error, true));
        onFailure?.(error);
      }
    } finally {
      if (alive.current) setEncBusy(false);
    }
  }

  return (
    <div data-slot="data-export-panel" className="grid gap-4 lg:grid-cols-2">
      {/* 1. 非敏感 CSV 导出 */}
      <GlassPanel variant="strong" className="flex flex-col justify-between gap-4 p-5">
        <div className="space-y-3.5">
          <div className="flex items-center gap-2.5 border-b border-[var(--table-divider)] pb-3">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <Download className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                非敏感 CSV 导出
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                UTF-8 BOM 格式，自动防护电子表格公式注入
              </p>
            </div>
          </div>

          <p className="text-[12.5px] leading-6 text-[var(--text-secondary)]">
            导出账号编号、Gmail 地址、注册/活动时间、辅助邮箱、状态、用途与标签；
            绝不包含密码、绑定手机号、备注、TOTP 密钥、恢复码或会话数据。
          </p>

          <label className="block space-y-1.5 text-[12.5px]">
            <span className="font-medium text-[var(--text-primary)]">
              导出范围
            </span>
            <NativeSelect
              aria-label="非敏感 CSV 导出范围"
              value={csvScope}
              disabled={exportBusy}
              onChange={(e) =>
                setCsvScope(e.target.value as 'all' | 'filtered')
              }
              className="h-9.5 rounded-xl border-white/80 bg-white/80 text-[13px]"
            >
              <option value="all">全部未删除账号（含归档）</option>
              <option value="filtered">按当前 URL 筛选条件导出</option>
            </NativeSelect>
          </label>

          {csvScope === 'filtered' && (
            <p className="break-all rounded-xl border border-white/80 bg-white/55 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              当前筛选参数：{currentSearch || '默认未删除（含归档）'}
              。导出将忽略页码与每页条数。
            </p>
          )}
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={exportBusy}
            onClick={() =>
              void onExportCsv(
                csvScope,
                csvScope === 'filtered' ? (filters as AccountQuery) : undefined,
              )
            }
            className="inline-flex h-9.5 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-55"
          >
            <Download className="size-4" aria-hidden="true" />
            <span>{exportBusy ? '正在生成 CSV…' : '下载非敏感 CSV'}</span>
          </button>
        </div>
      </GlassPanel>

      {/* 2. 带密码的流式加密导出（.gmenc） */}
      <GlassPanel variant="strong" className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--table-divider)] pb-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <Lock className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                流式加密完整导出（.gmenc）
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Argon2id + 64 KiB 分块 AES-256-GCM，明文不落盘
              </p>
            </div>
          </div>
          {!isMock && hasMfaStepUp && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--badge-green-text)]">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              MFA Step-Up 有效
            </span>
          )}
        </div>

        <p className="text-[12.5px] leading-6 text-[var(--text-secondary)]">
          包含完整敏感字段（Gmail 密码、绑定手机号与备注），强制要求近期 MFA
          Step-Up 二次验证并写入防篡改审计日志。
        </p>

        {isMock ? (
          <div className="rounded-xl border border-[var(--badge-slate-border)] bg-[var(--badge-slate-bg)] px-3.5 py-3 text-[12.5px] text-[var(--badge-slate-text)]">
            当前为本地预览模式，加密流式导出（.gmenc）仅在真实登录会话下可用。
          </div>
        ) : (
          <form onSubmit={(e) => void handleEncryptedSubmit(e)} className="space-y-3.5">
            <label className="block space-y-1.5 text-[12.5px]">
              <span className="font-medium text-[var(--text-primary)]">
                加密导出范围
              </span>
              <NativeSelect
                aria-label="加密导出范围"
                value={encScope}
                disabled={encBusy}
                onChange={(e) =>
                  setEncScope(e.target.value as 'all' | 'filtered')
                }
                className="h-9.5 rounded-xl border-white/80 bg-white/80 text-[13px]"
              >
                <option value="all">全部未删除账号（含归档与敏感凭据）</option>
                <option value="filtered">按当前 URL 筛选条件导出</option>
              </NativeSelect>
            </label>

            {!hasMfaStepUp && (
              <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-white/55 p-3.5">
                {canPasskeyStepUp && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] text-[var(--text-secondary)]">
                      优先使用已绑定的通行密钥完成 UV Step-Up 验证：
                    </span>
                    <button
                      type="button"
                      disabled={passkeyBusy || encBusy}
                      onClick={() => void handlePasskeyStepUp()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 text-[12px] font-semibold text-[var(--accent-text)] transition-colors hover:brightness-95 disabled:opacity-50"
                    >
                      <KeyRound className="size-3.5" aria-hidden="true" />
                      <span>
                        {passkeyBusy
                          ? '正在等待通行密钥…'
                          : '使用通行密钥完成 Step-Up'}
                      </span>
                    </button>
                  </div>
                )}

                {totpEnabled ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label
                        htmlFor={`${idPrefix}-admin-pwd`}
                        className="text-[12px] font-medium text-[var(--text-primary)]"
                      >
                        管理员密码（Step-Up）
                      </label>
                      <Input
                        id={`${idPrefix}-admin-pwd`}
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={1024}
                        disabled={encBusy}
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor={`${idPrefix}-totp`}
                        className="text-[12px] font-medium text-[var(--text-primary)]"
                      >
                        6 位 TOTP 验证码
                      </label>
                      <Input
                        id={`${idPrefix}-totp`}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        disabled={encBusy}
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                    {canPasskeyStepUp
                      ? '当前未启用 TOTP，请点击上方“使用通行密钥完成 Step-Up”后再执行加密导出。'
                      : '加密导出强制要求双因素二次验证。当前管理员尚未绑定 TOTP 或通行密钥，请先前往「系统设置 → 安全与认证」完成绑定后再执行加密导出。'}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor={`${idPrefix}-passphrase`}
                  className="text-[12px] font-medium text-[var(--text-primary)]"
                >
                  导出加密口令（至少 16 位）
                </label>
                <Input
                  id={`${idPrefix}-passphrase`}
                  type="password"
                  autoComplete="new-password"
                  minLength={16}
                  maxLength={1024}
                  required
                  disabled={encBusy}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`${idPrefix}-passphrase-confirm`}
                  className="text-[12px] font-medium text-[var(--text-primary)]"
                >
                  确认导出加密口令
                </label>
                <Input
                  id={`${idPrefix}-passphrase-confirm`}
                  type="password"
                  autoComplete="new-password"
                  minLength={16}
                  maxLength={1024}
                  required
                  disabled={encBusy}
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.target.value)}
                />
              </div>
            </div>

            <p className="text-[11.5px] text-[var(--text-secondary)]">
              导出口令不能与管理员登录密码相同，且服务端不存储该口令，请离线妥善保存。
            </p>

            <button
              type="submit"
              disabled={encBusy || (!hasMfaStepUp && !totpEnabled)}
              className="inline-flex h-9.5 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Lock className="size-4" aria-hidden="true" />
              <span>
                {encBusy ? '正在流式加密导出…' : '下载加密完整导出（.gmenc）'}
              </span>
            </button>

            {encError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 py-2 text-[12px] text-[var(--badge-red-text)]"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{encError}</span>
              </div>
            )}

            {encMessage && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-[12px] text-[var(--badge-green-text)]"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="break-all">{encMessage}</span>
              </div>
            )}
          </form>
        )}
      </GlassPanel>
    </div>
  );
}
