import { useCallback, useEffect, useRef, useState } from 'react';
import {
  accountsRevealSensitive,
  type SensitiveFieldsResponse,
  type SessionResponse,
} from '@/api/generated';

const SENSITIVE_TTL_MS = 20_000;

async function clipboardFingerprint(value: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function useSensitiveFields({
  accountId,
  resetEpoch = 0,
  session,
  onSession,
  onFailure,
  onToast,
}: {
  accountId: string;
  resetEpoch?: number;
  session?: SessionResponse;
  onSession?: (next: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onToast?: (message: string) => void;
}) {
  // 仅保存于组件局部内存，绝不写入 React Query 缓存或持久化存储。
  const [revealed, setRevealed] = useState<SensitiveFieldsResponse | null>(
    null,
  );
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [pending, setPending] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const generation = useRef(0);
  const mounted = useRef(true);
  const expiry = useRef<number | undefined>(undefined);
  const tickRef = useRef<number | undefined>(undefined);
  const copied = useRef<Promise<string | null> | null>(null);

  const clear = useCallback(() => {
    generation.current++;
    window.clearTimeout(expiry.current);
    window.clearInterval(tickRef.current);
    setRevealed(null);
    setRemainingSeconds(0);
    setPending(false);
    const previous = copied.current;
    copied.current = null;
    if (previous) {
      void navigator.clipboard
        ?.readText?.()
        .then(async (text) => {
          const prevHash = await previous;
          if (!prevHash) return;
          const currentHash = await clipboardFingerprint(text);
          if (currentHash && currentHash === prevHash) {
            return navigator.clipboard.writeText('');
          }
        })
        .catch(() => {
          /* 剪贴板清理仅尽力执行，避免延长敏感明文保留。 */
        });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    clear();
    setReauth(false);
    setStatusMessage('');

    const onVisibility = () => {
      if (document.hidden) {
        clear();
        setReauth(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      clear();
    };
  }, [accountId, resetEpoch, clear]);

  const reveal = useCallback(
    async (options?: { copyPhone?: boolean }) => {
      if (!session || pending) return;
      const ticket = ++generation.current;
      setPending(true);
      setStatusMessage('');
      try {
        const { data } = await accountsRevealSensitive({
          path: { account_id: accountId },
          body: {},
          headers: { 'X-CSRF-Token': session.csrf_token },
          throwOnError: true,
        });
        if (
          ticket !== generation.current ||
          !mounted.current ||
          document.hidden
        ) {
          return;
        }
        setRevealed(data);
        setRemainingSeconds(20);
        setReauth(false);
        window.clearTimeout(expiry.current);
        window.clearInterval(tickRef.current);
        const expiresAtMs = Date.now() + SENSITIVE_TTL_MS;
        expiry.current = window.setTimeout(clear, SENSITIVE_TTL_MS);
        tickRef.current = window.setInterval(() => {
          setRemainingSeconds(
            Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)),
          );
        }, 1000);

        if (options?.copyPhone && data.phone) {
          copied.current = clipboardFingerprint(data.phone);
          try {
            await navigator.clipboard.writeText(data.phone);
            if (
              ticket === generation.current &&
              mounted.current &&
              !document.hidden
            ) {
              setStatusMessage(
                '手机号已复制，20 秒后自动隐藏并尝试清理剪贴板。',
              );
              onToast?.('已复制手机号（20 秒后自动隐藏）');
            }
          } catch {
            if (
              ticket === generation.current &&
              mounted.current &&
              !document.hidden
            ) {
              copied.current = null;
              setStatusMessage('浏览器未允许复制，请手动选择手机号复制。');
            }
          }
        } else {
          setStatusMessage(
            '已解锁查看，20 秒后自动隐藏；切换账号或隐藏页面将立即清除。',
          );
        }
      } catch (error) {
        if (
          ticket !== generation.current ||
          !mounted.current ||
          document.hidden
        ) {
          return;
        }
        clear();
        if (
          (error as { error?: { code?: string } })?.error?.code ===
          'REAUTH_REQUIRED'
        ) {
          setReauth(true);
          setStatusMessage(
            '请先完成管理员重新验证后，再点击查看手机号与备注。',
          );
        } else {
          setStatusMessage('读取敏感资料失败，未自动重试。');
          onFailure?.(error);
        }
      } finally {
        if (ticket === generation.current && mounted.current) {
          setPending(false);
        }
      }
    },
    [accountId, clear, onFailure, onToast, pending, session],
  );

  const handleVerified = useCallback(
    (nextSession: SessionResponse) => {
      onSession?.(nextSession);
      setReauth(false);
      setStatusMessage('管理员二次验证通过，请再次点击查看手机号与敏感备注。');
    },
    [onSession],
  );

  return {
    revealed,
    remainingSeconds,
    pending,
    reauth,
    statusMessage,
    reveal,
    clear,
    handleVerified,
  };
}
