import { AlertTriangle, Ban, CheckCircle2 } from 'lucide-react';
import type { AccountAppItem } from '@/api/generated';
import { cn } from '@/lib/utils';
import { AppBrandIcon } from './app-brand-icon';
import { appStatusLabels, localDate } from './constants';

export function AccountAppPill({
  app,
  compact = false,
  className,
}: {
  app: Pick<
    AccountAppItem,
    'app_name' | 'app_domain' | 'app_icon_data' | 'status' | 'note' | 'banned_at'
  >;
  compact?: boolean;
  className?: string;
}) {
  const isBanned = app.status === 'banned';
  const isRestricted = app.status === 'restricted';

  const tooltipParts = [
    `${app.app_name} · ${appStatusLabels[app.status]}`,
    app.note ? `备注：${app.note}` : null,
    isBanned && app.banned_at ? `封禁时间：${localDate(app.banned_at)}` : null,
  ].filter(Boolean);

  return (
    <span
      data-slot="account-app-pill"
      data-status={app.status}
      title={tooltipParts.join('\n')}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        compact ? 'px-2 py-0.5 text-[11px] leading-4' : 'px-2.5 py-0.5 text-xs',
        isBanned
          ? 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]'
          : isRestricted
            ? 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]'
            : 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]',
        className,
      )}
    >
      <AppBrandIcon
        name={app.app_name}
        domain={app.app_domain}
        iconData={app.app_icon_data}
        size="xs"
        className={cn(isBanned && 'opacity-70 grayscale-[35%]')}
      />
      <span className={cn(isBanned && 'line-through decoration-current/70')}>
        {app.app_name}
      </span>
      {isBanned ? (
        <Ban className="size-3 shrink-0" aria-hidden="true" />
      ) : isRestricted ? (
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
      )}
      {!compact && (
        <span className="opacity-85">· {appStatusLabels[app.status]}</span>
      )}
    </span>
  );
}
