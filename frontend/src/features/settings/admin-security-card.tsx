import { Check, KeyRound, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SettingsCardShell } from './settings-card-shell';
import type { AdminSecurityInfo, CardStateMode } from './types';

export function AdminSecurityCard({
  info,
  isRecentlyVerified,
  state = 'ready',
  onOpenChangePassword,
  onOpenReverify,
  onRetry,
}: {
  info: AdminSecurityInfo;
  isRecentlyVerified: boolean;
  state?: CardStateMode;
  onOpenChangePassword: () => void;
  onOpenReverify?: () => void;
  onRetry?: () => void;
}) {
  return (
    <SettingsCardShell
      id="settings-card-admin-security"
      title="管理员安全"
      subtitle="单管理员账户认证与强口令策略"
      icon={<ShieldCheck className="size-4" />}
      state={state}
      loadingText="正在读取管理员安全状态…"
      onRetry={onRetry}
      headerRight={
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap',
            info.healthy
              ? 'border-[#2fbf71]/28 bg-[#2fbf71]/[0.09] text-[#147240]'
              : 'border-[#e45d5d]/28 bg-[#e45d5d]/[0.09] text-[#b43636]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              info.healthy ? 'bg-[var(--success)]' : 'bg-[var(--danger)]',
            )}
          />
          <span>{info.statusLabel}</span>
        </span>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/75 bg-white/44 p-3.5">
        <dl className="grid min-w-0 flex-1 grid-cols-1 gap-2.5 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-[12px] text-[var(--text-secondary)]">
              管理员账号
            </dt>
            <dd className="mt-0.5 font-mono text-[13.5px] font-semibold text-[var(--text-primary)]">
              {info.username}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-[var(--text-secondary)]">
              密码强度
            </dt>
            <dd className="mt-0.5 inline-flex items-center gap-1.5 font-medium text-[#147240]">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-[var(--success)]"
              />
              <span>{info.passwordStrengthLabel}</span>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[12px] text-[var(--text-secondary)]">
              上次修改时间
            </dt>
            <dd className="mt-0.5 text-[13px] tabular-nums text-[var(--text-primary)]">
              {info.passwordChangedAt}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onOpenChangePassword}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/85 bg-white/72 px-3.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/92"
        >
          <KeyRound
            className="size-3.5 text-[var(--accent)]"
            aria-hidden="true"
          />
          <span>修改密码…</span>
        </button>
      </div>

      {/* 密码策略 */}
      <div className="space-y-2">
        <p className="text-[12.5px] font-semibold text-[#475467]">密码策略</p>
        <ul className="flex flex-wrap gap-2">
          {info.policies.map((policy) => (
            <li
              key={policy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/75 bg-white/44 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)]"
            >
              <Check
                className="size-3.5 shrink-0 text-[var(--success)]"
                aria-hidden="true"
              />
              <span>{policy}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 最近重新验证状态提示 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--table-divider)] pt-3 text-[12px] text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              isRecentlyVerified ? 'bg-[var(--success)]' : 'bg-[#94a3b8]',
            )}
          />
          <span>
            {isRecentlyVerified
              ? '高风险重新验证：当前有效（5 分钟窗口）'
              : '高风险操作执行前将要求重新验证管理员身份'}
          </span>
        </span>
        {onOpenReverify && !isRecentlyVerified && (
          <button
            type="button"
            onClick={onOpenReverify}
            className="rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            立即重新验证
          </button>
        )}
      </div>
    </SettingsCardShell>
  );
}
