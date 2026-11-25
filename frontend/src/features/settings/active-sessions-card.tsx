import { Laptop, LogOut, Monitor } from 'lucide-react';
import { SettingsCardShell } from './settings-card-shell';
import type { ActiveSessionRow, CardStateMode } from './types';

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
  const otherSessionsCount = sessions.filter((s) => !s.current).length;

  return (
    <SettingsCardShell
      id="settings-card-active-sessions"
      title="活动会话"
      subtitle="已认证管理终端与实时登录状态"
      icon={<Monitor className="size-4" />}
      state={state}
      loadingText="正在读取活动会话…"
      errorText={errorText ?? '无法读取活动会话列表，请稍后手动重试。'}
      emptyTitle="暂无活动会话"
      emptyDescription="当前没有可管理的有效登录会话记录。"
      onRetry={onRetry}
      headerRight={
        <button
          type="button"
          disabled={state !== 'ready' || otherSessionsCount === 0}
          onClick={onLogoutOtherSessions}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#e45d5d]/28 bg-[#e45d5d]/[0.07] px-3 text-[12.5px] font-medium text-[#b84040] transition-all duration-[180ms] ease-out hover:bg-[#e45d5d]/[0.14] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          <span>退出其他会话</span>
        </button>
      }
    >
      <div className="macos-thin-scrollbar w-full max-w-full overflow-x-auto rounded-2xl border border-white/75 bg-white/44">
        <table
          aria-label="活动会话列表"
          className="w-full min-w-[460px] border-collapse text-left text-[13px]"
        >
          <thead>
            <tr className="border-b border-[var(--table-divider)] bg-white/40 text-[11.5px] font-semibold text-[#475467]">
              <th className="px-3 py-2.5 font-semibold">设备与浏览器</th>
              <th className="px-3 py-2.5 font-semibold">IP 地址</th>
              <th className="px-3 py-2.5 font-semibold">登录时间</th>
              <th className="px-3 py-2.5 font-semibold">最后活动</th>
              <th className="px-3 py-2.5 text-right font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--table-divider)]">
            {sessions.map((item) => (
              <tr
                key={item.id}
                className="transition-colors hover:bg-[var(--table-row-hover)]"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Laptop
                      className="size-3.5 shrink-0 text-[#475467]"
                      aria-hidden="true"
                    />
                    <span className="font-medium text-[var(--text-primary)]">
                      {item.deviceBrowser}
                    </span>
                    {item.current && (
                      <span className="inline-flex items-center rounded-full border border-[#1677ff]/24 bg-[#1677ff]/12 px-2 py-0.5 text-[11px] font-semibold text-[#0d4bb3]">
                        当前会话
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] whitespace-nowrap tabular-nums text-[#475467]">
                  {item.ipAddress}
                </td>
                <td
                  data-dynamic="timestamp"
                  className="px-3 py-2.5 text-[12px] whitespace-nowrap tabular-nums text-[#475467]"
                >
                  {item.loginAt}
                </td>
                <td
                  data-dynamic="timestamp"
                  className="px-3 py-2.5 text-[12px] whitespace-nowrap tabular-nums text-[var(--text-primary)]"
                >
                  {item.lastActiveAt}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    aria-label={`终止会话 ${item.deviceBrowser}`}
                    disabled={item.state === 'revoked'}
                    onClick={() => onTerminateSession(item)}
                    className="inline-flex h-7 items-center rounded-lg border border-[#e45d5d]/26 bg-white/65 px-2.5 text-[12px] font-medium text-[#b84040] transition-colors hover:bg-[#e45d5d]/[0.1] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    终止
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-[var(--text-secondary)]">
        终止会话与退出其他会话均为高风险操作，需最近完成重新验证且不自动重试。
      </p>
    </SettingsCardShell>
  );
}
