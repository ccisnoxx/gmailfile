import { useState } from 'react';
import {
  Laptop,
  LogOut,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { SettingsCardShell } from './settings-card-shell';
import type { ActiveSessionRow, CardStateMode } from './types';

const stateLabels: Record<ActiveSessionRow['state'], string> = {
  valid: '有效',
  idle_expired: '闲置过期',
  absolute_expired: '绝对过期',
  revoked: '已撤销',
};

function DeviceIcon({ type }: { type?: ActiveSessionRow['deviceType'] }) {
  if (type === 'mobile') {
    return (
      <Smartphone
        className="size-3.5 shrink-0 text-[var(--text-secondary)]"
        aria-hidden="true"
      />
    );
  }
  if (type === 'tablet') {
    return (
      <Tablet
        className="size-3.5 shrink-0 text-[var(--text-secondary)]"
        aria-hidden="true"
      />
    );
  }
  return (
    <Laptop
      className="size-3.5 shrink-0 text-[var(--text-secondary)]"
      aria-hidden="true"
    />
  );
}

export function ActiveSessionsCard({
  sessions,
  state = 'ready',
  errorText,
  onTerminateSession,
  onLogoutOtherSessions,
  onRetry,
}: {
  sessions: ActiveSessionRow[];
  state?: CardStateMode;
  errorText?: string | null;
  onTerminateSession: (session: ActiveSessionRow) => void;
  onLogoutOtherSessions: () => void;
  onRetry?: () => void;
}) {
  const [filterMode, setFilterMode] = useState<'all' | 'active'>('all');
  const otherSessionsCount = sessions.filter(
    (s) => !s.current && s.state === 'valid',
  ).length;
  const visibleSessions =
    filterMode === 'active'
      ? sessions.filter((s) => s.state === 'valid')
      : sessions;

  return (
    <SettingsCardShell
      id="settings-card-active-sessions"
      title="活动会话"
      subtitle="已认证管理终端、设备与浏览器识别及实时登录状态"
      icon={<Monitor className="size-4" />}
      state={state}
      loadingText="正在读取活动会话…"
      errorText={errorText ?? '无法读取活动会话列表，请稍后手动重试。'}
      emptyTitle="暂无活动会话"
      emptyDescription="当前没有可管理的有效登录会话记录。"
      onRetry={onRetry}
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="会话筛选"
            className="inline-flex h-8 items-center rounded-xl border border-white/80 bg-white/55 p-0.5 text-[11.5px]"
          >
            <button
              type="button"
              aria-pressed={filterMode === 'all'}
              onClick={() => setFilterMode('all')}
              className={
                filterMode === 'all'
                  ? 'rounded-[9px] bg-[var(--accent)] px-2 py-1 font-medium text-[var(--primary-foreground)]'
                  : 'rounded-[9px] px-2 py-1 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            >
              全部
            </button>
            <button
              type="button"
              aria-pressed={filterMode === 'active'}
              onClick={() => setFilterMode('active')}
              className={
                filterMode === 'active'
                  ? 'rounded-[9px] bg-[var(--accent)] px-2 py-1 font-medium text-[var(--primary-foreground)]'
                  : 'rounded-[9px] px-2 py-1 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            >
              仅活跃
            </button>
          </div>
          <button
            type="button"
            disabled={state !== 'ready' || otherSessionsCount === 0}
            onClick={onLogoutOtherSessions}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 text-[12.5px] font-medium text-[var(--badge-red-text)] transition-all duration-[180ms] ease-out hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            <span>退出其他会话</span>
          </button>
        </div>
      }
    >
      <div className="macos-thin-scrollbar w-full max-w-full overflow-x-auto rounded-2xl border border-white/75 bg-white/44">
        <table
          aria-label="活动会话列表"
          className="w-full border-collapse text-left text-[12.5px]"
        >
          <thead>
            <tr className="border-b border-[var(--table-divider)] bg-[var(--surface-table-head)] text-[11.5px] font-semibold text-[var(--text-secondary)]">
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                设备与来源
              </th>
              <th className="px-2 py-2.5 font-semibold whitespace-nowrap">
                登录时间
              </th>
              <th className="px-2 py-2.5 font-semibold whitespace-nowrap">
                最后活动
              </th>
              <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--table-divider)]">
            {visibleSessions.map((item) => (
              <tr
                key={item.id}
                className="transition-colors hover:bg-[var(--table-row-hover)]"
              >
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DeviceIcon type={item.deviceType} />
                    <span className="font-medium text-[var(--text-primary)]">
                      {item.deviceBrowser}
                    </span>
                    {item.current && (
                      <span className="inline-flex items-center rounded-full border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--badge-blue-text)]">
                        当前会话
                      </span>
                    )}
                    {item.mfaReauthenticated && (
                      <span
                        title="最近 5 分钟内已完成高风险 Step-Up 验证"
                        className="inline-flex items-center gap-0.5 rounded-full bg-[var(--badge-green-bg)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--badge-green-text)]"
                      >
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        Step-Up
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]">
                    <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {item.ipAddress}
                    </span>
                    <span
                      className={
                        item.state === 'valid'
                          ? 'rounded-full bg-[var(--badge-green-bg)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--badge-green-text)]'
                          : 'rounded-full bg-[var(--badge-slate-bg)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--badge-slate-text)]'
                      }
                    >
                      {stateLabels[item.state]}
                    </span>
                  </div>
                </td>
                <td
                  data-dynamic="timestamp"
                  className="px-2 py-2.5 text-[11.5px] whitespace-nowrap tabular-nums text-[var(--text-secondary)]"
                >
                  {item.loginAt}
                </td>
                <td
                  data-dynamic="timestamp"
                  className="px-2 py-2.5 text-[11.5px] whitespace-nowrap tabular-nums text-[var(--text-primary)]"
                >
                  {item.lastActiveAt}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`终止会话 ${item.deviceBrowser}`}
                    disabled={item.state !== 'valid'}
                    onClick={() => onTerminateSession(item)}
                    className="inline-flex h-7 items-center rounded-lg border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-2.5 text-[12px] font-medium text-[var(--badge-red-text)] transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    终止
                  </button>
                </td>
              </tr>
            ))}
            {visibleSessions.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-4 text-center text-xs text-[var(--text-secondary)]"
                >
                  当前筛选条件下暂无会话记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-[var(--text-secondary)]">
        终止会话与退出其他会话均为高风险操作，需最近完成重新验证且不自动重试。设备标签仅通过服务端受控白名单解析，不保存原始
        User-Agent。
      </p>
    </SettingsCardShell>
  );
}
