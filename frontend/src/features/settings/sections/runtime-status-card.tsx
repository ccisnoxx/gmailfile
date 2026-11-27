import { Cpu } from 'lucide-react';
import { SettingsCardShell } from '../settings-card-shell';
import type { CardStateMode, SystemRuntimeInfo } from '../types';

export function RuntimeStatusCard({
  runtime,
  state,
  onOpenRetentionSheet,
  onRetry,
}: {
  runtime: SystemRuntimeInfo;
  state: CardStateMode;
  onOpenRetentionSheet: () => void;
  onRetry: () => void;
}) {
  return (
    <SettingsCardShell
      id="settings-card-runtime"
      title="运行环境与会话安全"
      subtitle="服务版本、数据库 Schema 与空闲自动锁定策略"
      icon={<Cpu className="size-4" />}
      state={state}
      onRetry={onRetry}
      headerRight={
        <button
          type="button"
          onClick={onOpenRetentionSheet}
          className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/72 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white"
        >
          调整自动锁定…
        </button>
      }
    >
      <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-white/75 bg-white/44 p-3.5 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">
            应用版本 / Schema
          </dt>
          <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
            {runtime.appVersion} / {runtime.schemaVersion}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">
            空闲自动锁定
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">
            {runtime.idleMinutes} 分钟
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">
            凭据存储加密
          </dt>
          <dd className="mt-0.5 font-medium text-[var(--text-primary)]">
            AES-256-GCM 独立字段加密
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--text-secondary)]">
            敏感缓存策略
          </dt>
          <dd className="mt-0.5 font-medium text-[var(--success-text)]">
            禁止写入 Query Cache 与 localStorage
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[12px] text-[var(--text-secondary)]">加密边界</dt>
          <dd className="mt-0.5 leading-5 text-[var(--text-secondary)]">
            本系统为服务端可解密保险库（非客户端零知识）：传输层由 TLS
            保护，密码、手机号与敏感备注以字段级密文存储，仅在管理员通过授权与重新验证后由服务端按需解密返回。
          </dd>
        </div>
      </dl>
    </SettingsCardShell>
  );
}
