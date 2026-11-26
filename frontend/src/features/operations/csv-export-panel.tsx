import { useEffect, useId, useRef, useState } from 'react';
import { Download, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { authReverify, csvExport, encryptedExport } from '@/api/generated';
import type { AccountQuery } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { accountQuery } from '@/features/accounts/query-state';
import {
  formatWebAuthnError,
  isWebAuthnSupported,
  performPasskeyStepUp,
} from '@/lib/webauthn';
import { failureText, type OperationsPanelProps } from './shared';

function isUntilActive(until?: string | null): boolean {
  if (!until) return false;
  const ms = Date.parse(until);
  return Number.isFinite(ms) && ms > Date.now();
}

export function ExportPanel(props: OperationsPanelProps) {
  const [scope, setScope] = useState<'all' | 'filtered'>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // 高敏加密导出状态（仅组件内存，绝不进入 Query 缓存或 localStorage）
  const [encScope, setEncScope] = useState<'all' | 'filtered'>('all');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [encBusy, setEncBusy] = useState(false);
  const [encMessage, setEncMessage] = useState('');
  const [encError, setEncError] = useState('');
  const [latestCsrf, setLatestCsrf] = useState(props.session.csrf_token);

  const alive = useRef(true);
  const idPrefix = useId();

  useEffect(() => {
    setLatestCsrf(props.session.csrf_token);
  }, [props.session.csrf_token]);

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

  const filters = accountQuery(new URLSearchParams(window.location.search));
  const [stepUpConfirmed, setStepUpConfirmed] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const hasMfaStepUp =
    stepUpConfirmed ||
    (isUntilActive(props.session.reauthenticated_until) &&
      isUntilActive(props.session.mfa_reauthenticated_until));
  const canPasskeyStepUp =
    Boolean(props.session.webauthn_enabled) && isWebAuthnSupported();
  const totpEnabled = props.session.totp_enabled !== false;

  async function handlePasskeyStepUp() {
    if (passkeyBusy || encBusy) return;
    setEncError('');
    setEncMessage('');
    setPasskeyBusy(true);
    try {
      const updated = await performPasskeyStepUp(latestCsrf);
      if (!alive.current || document.hidden) return;
      setLatestCsrf(updated.csrf_token);
      setStepUpConfirmed(true);
      props.onSession?.(updated);
      setEncMessage(
        '通行密钥 Step-Up 验证成功，现在可填写导出加密口令并下载。',
      );
    } catch (error) {
      if (alive.current) {
        setEncError(formatWebAuthnError(error));
        props.onFailure(error);
      }
    } finally {
      if (alive.current) setPasskeyBusy(false);
    }
  }

  async function handleEncryptedExport(event: React.FormEvent) {
    event.preventDefault();
    if (encBusy) return;
    setEncMessage('');
    setEncError('');

    if (passphrase.length < 16) {
      setEncError('导出加密口令至少需要 16 位字符，建议使用多词短语。');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setEncError('两次输入的导出加密口令不一致。');
      return;
    }

    const secretPassphrase = passphrase;
    const stepUpPassword = adminPassword;
    const stepUpTotp = totpCode.trim();
    // 立即清空表单输入，缩短内存驻留窗口
    setPassphrase('');
    setPassphraseConfirm('');
    setAdminPassword('');
    setTotpCode('');

    setEncBusy(true);
    try {
      let csrfToken = latestCsrf;
      if (!hasMfaStepUp) {
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
          setLatestCsrf(csrfToken);
          props.onSession?.(reauth.data);
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
      const url = URL.createObjectURL(result.data);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        /filename="([^"]+)"/.exec(
          result.response.headers.get('Content-Disposition') || '',
        )?.[1] || 'gmail-accounts-encrypted.gmenc';
      a.click();
      URL.revokeObjectURL(url);
      setEncMessage(
        '加密导出包（.gmenc）已开始下载。离线解密命令：python -m app.cli decrypt-export --input <文件.gmenc> --output <输出.csv>',
      );
    } catch (error) {
      if (alive.current) {
        setEncError(failureText(error, true));
        props.onFailure(error);
      }
    } finally {
      if (alive.current) setEncBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* 1. 非敏感 CSV 导出 */}
      <section aria-label="非敏感 CSV 导出" className="space-y-5">
        <h2 className="text-lg font-semibold">非敏感 CSV 导出</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          导出编号、邮箱、注册/活动时间、辅助邮箱、状态、用途和标签；不包含密码、手机号、备注、TOTP、恢复码或
          Session 数据。UTF-8 BOM 可供 Excel 打开，公式前缀会加单引号。
        </p>
        <label className="block space-y-2">
          <span>导出范围</span>
          <NativeSelect
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="all">全部未删除账号（含归档）</option>
            <option value="filtered">
              账号列表当前筛选的全部结果（非当前页）
            </option>
          </NativeSelect>
        </label>
        {scope === 'filtered' && (
          <p className="break-all rounded-lg bg-muted p-3 text-sm">
            筛选：{window.location.search || '默认未删除，含归档'}
            。日期与列表相同，导出忽略页码和每页条数。
          </p>
        )}
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              const result = await csvExport({
                body:
                  scope === 'all'
                    ? { scope }
                    : { scope, filters: filters as AccountQuery },
                headers: { 'X-CSRF-Token': latestCsrf },
                parseAs: 'blob',
                throwOnError: true,
              });
              if (!alive.current || document.hidden) return;
              const url = URL.createObjectURL(result.data);
              const a = document.createElement('a');
              a.href = url;
              a.download =
                /filename="([^"]+)"/.exec(
                  result.response.headers.get('Content-Disposition') || '',
                )?.[1] || 'gmail-accounts.csv';
              a.click();
              URL.revokeObjectURL(url);
              setMessage('导出文件已交给浏览器下载。');
            } catch (error) {
              if (alive.current) {
                setMessage(failureText(error));
                props.onFailure(error);
              }
            } finally {
              if (alive.current) setBusy(false);
            }
          }}
        >
          <Download />
          {busy ? '正在准备…' : '下载非敏感 CSV'}
        </Button>
        {message && <p role="status">{message}</p>}
      </section>

      <hr className="border-[var(--table-divider)]" />

      {/* 2. 带密码的流式加密导出（P1 #1） */}
      <section aria-label="带密码的流式加密导出" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Lock className="size-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            带密码的流式加密导出（.gmenc）
          </h2>
          {hasMfaStepUp && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--success-text)]">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              MFA Step-Up 有效
            </span>
          )}
        </div>
        <p className="text-sm leading-7 text-muted-foreground">
          包含完整敏感字段（Gmail
          密码、绑定手机号与备注），服务端采用版本化分块流式加密（GME1 /
          Argon2id + 64 KiB 分块 AES-256-GCM），明文绝不写入服务器磁盘，且受
          Step-Up 二次验证、并发导出槽位与防篡改审计保护。
        </p>

        <form onSubmit={handleEncryptedExport} className="space-y-4">
          <label className="block space-y-2">
            <span>加密导出范围</span>
            <NativeSelect
              aria-label="加密导出范围"
              value={encScope}
              onChange={(e) => setEncScope(e.target.value as typeof encScope)}
            >
              <option value="all">全部未删除账号（含归档与敏感凭据）</option>
              <option value="filtered">账号列表当前筛选的全部结果</option>
            </NativeSelect>
          </label>

          {!hasMfaStepUp && (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-muted/40 p-4">
              {canPasskeyStepUp && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    可使用已绑定的通行密钥直接完成 UV Step-Up 验证：
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={passkeyBusy || encBusy}
                    onClick={() => void handlePasskeyStepUp()}
                  >
                    <KeyRound className="size-4" aria-hidden="true" />
                    {passkeyBusy
                      ? '正在等待通行密钥…'
                      : '使用通行密钥（Passkey）完成 Step-Up'}
                  </Button>
                </div>
              )}
              {totpEnabled ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${idPrefix}-admin-pwd`}
                      className="text-sm font-medium"
                    >
                      当前管理员密码（Step-Up）
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
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${idPrefix}-totp`}
                      className="text-sm font-medium"
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
                <p className="text-xs text-muted-foreground">
                  当前已停用 TOTP，请点击上方按钮使用通行密钥完成 Step-Up
                  二次验证后再导出。
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor={`${idPrefix}-export-pass`}
                className="text-sm font-medium"
              >
                导出文件独立加密口令（至少 16 位）
              </label>
              <Input
                id={`${idPrefix}-export-pass`}
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
            <div className="space-y-1.5">
              <label
                htmlFor={`${idPrefix}-export-pass-confirm`}
                className="text-sm font-medium"
              >
                确认导出加密口令
              </label>
              <Input
                id={`${idPrefix}-export-pass-confirm`}
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

          <p className="text-xs text-muted-foreground">
            导出口令不能与管理员登录密码相同，且服务端不会保存该口令；请务必离线妥善记录。
          </p>

          <Button type="submit" disabled={encBusy}>
            <Lock className="size-4" aria-hidden="true" />
            {encBusy ? '正在流式加密导出…' : '下载加密完整导出（.gmenc）'}
          </Button>
        </form>

        {encError && (
          <p role="alert" className="text-sm text-destructive">
            {encError}
          </p>
        )}
        {encMessage && (
          <p role="status" className="text-sm text-[var(--success-text)]">
            {encMessage}
          </p>
        )}
      </section>
    </div>
  );
}
