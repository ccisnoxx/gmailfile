import { useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import type { AccountDetail, SessionResponse } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { StepUpVerifier } from '@/features/auth/step-up-verifier';
import { useSensitiveFields } from './detail/use-sensitive-fields';

export function SensitiveFieldsControl({
  detail,
  session,
  onSession,
  onFailure,
  onCopy,
}: {
  detail: AccountDetail;
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onCopy: (value: string) => void;
}) {
  const [localSession, setLocalSession] = useState(session);
  if (localSession.csrf_token !== session.csrf_token) {
    setLocalSession(session);
  }

  const hasPhone = Boolean(detail.has_phone || detail.phone);
  const hasNotes = Boolean(detail.has_notes || detail.notes);
  const sensitive = useSensitiveFields({
    accountId: detail.id,
    session: localSession,
    onSession: (next) => {
      setLocalSession(next);
      onSession(next);
    },
    onFailure,
  });

  if (!hasPhone && !hasNotes) {
    return null;
  }

  const displayedPhone = sensitive.revealed
    ? sensitive.revealed.phone
    : detail.phone;
  const displayedNotes = sensitive.revealed
    ? sensitive.revealed.notes
    : detail.notes;
  const isRevealed = Boolean(
    sensitive.revealed || detail.phone || detail.notes,
  );

  return (
    <section
      aria-label="敏感资料查看"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">绑定手机号与敏感备注</span>
        <div className="flex gap-2">
          {isRevealed && sensitive.revealed ? (
            <Button size="sm" variant="ghost" onClick={sensitive.clear}>
              <EyeOff className="size-3.5" aria-hidden="true" />
              立即隐藏
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={sensitive.pending}
              onClick={() => void sensitive.reveal()}
            >
              <Eye className="size-3.5" aria-hidden="true" />
              {sensitive.pending ? '正在加载…' : '查看手机号与备注'}
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">绑定手机号</dt>
        <dd className="flex flex-wrap items-center gap-2 break-all">
          <span>
            {hasPhone
              ? (displayedPhone ?? '已加密保存（需验证后查看）')
              : '未绑定'}
          </span>
          {displayedPhone && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCopy(displayedPhone)}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              复制手机号
            </Button>
          )}
        </dd>
        <dt className="text-muted-foreground">敏感备注</dt>
        <dd className="whitespace-pre-wrap break-words">
          {hasNotes
            ? (displayedNotes ?? '已加密保存（需验证后查看）')
            : '未填写'}
        </dd>
      </dl>

      {sensitive.revealed && sensitive.remainingSeconds > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>自动隐藏倒计时</span>
            <span>{sensitive.remainingSeconds}s</span>
          </div>
          <div
            role="progressbar"
            data-slot="secret-countdown-bar"
            aria-label="敏感资料自动隐藏倒计时"
            aria-valuemin={0}
            aria-valuemax={20}
            aria-valuenow={sensitive.remainingSeconds}
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-control)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-700 ease-linear"
              style={{ width: `${(sensitive.remainingSeconds / 20) * 100}%` }}
            />
          </div>
        </div>
      )}

      {sensitive.statusMessage && (
        <p role="status" className="text-xs text-muted-foreground">
          {sensitive.statusMessage}
        </p>
      )}

      {sensitive.reauth && (
        <StepUpVerifier
          session={localSession}
          requireMfa={Boolean(localSession.step_up_totp_required)}
          forceVerify
          actionLabel="查看手机号与备注"
          onVerified={sensitive.handleVerified}
          onFailure={onFailure}
        />
      )}
    </section>
  );
}
