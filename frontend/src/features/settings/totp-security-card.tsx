import { KeySquare, ShieldCheck, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SettingsCardShell } from './settings-card-shell';
import type { CardStateMode, TotpSecurityInfo } from './types';

export function TotpSecurityCard({
  info,
  state = 'ready',
  onOpenRecoveryCodes,
  onRetry,
}: {
  info: TotpSecurityInfo;
  state?: CardStateMode;
  onOpenRecoveryCodes: () => void;
  onRetry?: () => void;
}) {
  return (
    <SettingsCardShell
      id="settings-card-totp"
      title="双因素认证（TOTP）"
      subtitle="基于时间的一次性动态口令与离线备用恢复码"
      icon={<Smartphone className="size-4" />}
      state={state}
      loadingText="正在读取 TOTP 绑定状态…"
      onRetry={onRetry}
      headerRight={
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap',
            info.enabled
              ? 'border-[#2fbf71]/28 bg-[#2fbf71]/[0.09] text-[#147240]'
              : 'border-[#f5a623]/30 bg-[#f5a623]/[0.1] text-[#9a5c05]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              info.enabled ? 'bg-[var(--success)]' : 'bg-[var(--warning)]',
            )}
          />
          <span>{info.enabled ? '已启用' : '未启用'}</span>
        </span>
      }
    >
      <div className="grid items-stretch gap-3.5 sm:grid-cols-[minmax(0,1fr)_172px]">
        {/* 左侧：绑定状态、认证应用与恢复码 */}
        <div className="flex flex-col justify-between gap-3">
          <dl className="space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[12.5px] text-[var(--text-secondary)]">
                绑定状态
              </dt>
              <dd className="inline-flex items-center gap-1 font-medium text-[#147240]">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                <span>{info.bound ? '已绑定' : '未绑定'}</span>
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[12.5px] text-[var(--text-secondary)]">
                认证应用
              </dt>
              <dd className="text-[13px] leading-5 text-[var(--text-primary)]">
                {info.authenticatorApps}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[12.5px] text-[var(--text-secondary)]">
                备用恢复码
              </dt>
              <dd className="font-medium tabular-nums text-[var(--text-primary)]">
                {info.recoveryCodesRemaining !== null
                  ? `${info.recoveryCodesTotal} 个，剩余 ${info.recoveryCodesRemaining} 个`
                  : `共 ${info.recoveryCodesTotal} 个（服务端单向摘要保存）`}
              </dd>
            </div>
          </dl>

          <div className="pt-1">
            <button
              type="button"
              onClick={onOpenRecoveryCodes}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/72 px-3.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/92"
            >
              <KeySquare
                className="size-3.5 text-[var(--accent)]"
                aria-hidden="true"
              />
              <span>查看 / 重新生成…</span>
            </button>
          </div>
        </div>

        {/* 右侧：抽象六位验证码演示卡片（不展示真实 Secret） */}
        <div
          role="region"
          data-slot="totp-demo-card"
          aria-label="动态验证码演示卡片"
          className="flex flex-col items-center justify-between rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(234,243,255,0.72),rgba(255,255,255,0.52))] p-3.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        >
          <span className="inline-flex items-center rounded-full border border-[#1677ff]/20 bg-white/72 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
            演示状态
          </span>
          <div className="my-2">
            <p className="font-mono text-[24px] leading-none font-semibold tracking-[0.14em] tabular-nums text-[var(--text-primary)]">
              {info.demoCode}
            </p>
            <div
              aria-hidden="true"
              className="mx-auto mt-2.5 h-1 w-20 overflow-hidden rounded-full bg-[#1677ff]/15"
            >
              <div className="h-full w-2/3 rounded-full bg-[var(--accent)]/80" />
            </div>
          </div>
          <p className="text-[11px] leading-4 text-[var(--text-secondary)]">
            抽象验证码示意 · 不展示真实 Secret
          </p>
        </div>
      </div>
    </SettingsCardShell>
  );
}
