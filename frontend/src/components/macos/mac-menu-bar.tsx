import { useEffect, useState } from 'react';
import { ShieldCheck, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';

const MENU_ITEMS = ['文件', '编辑', '查看', '窗口', '帮助'] as const;

function formatMenuBarClock(now: Date): string {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const wd = weekdays[now.getDay()];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${wd} ${hh}:${mm}`;
}

export function MacMenuBar({
  appName = 'Gmail 账号管理',
  statusLabel = '系统正常',
  healthy = true,
  className,
}: {
  appName?: string;
  statusLabel?: string;
  healthy?: boolean;
  className?: string;
}) {
  const [clock, setClock] = useState<string>(() =>
    formatMenuBarClock(new Date()),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(formatMenuBarClock(new Date()));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      data-slot="macos-menu-bar"
      role="presentation"
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex h-6 select-none items-center justify-between border-b border-white/60 bg-[rgba(242,248,255,0.74)] px-3.5 text-[11.5px] leading-none text-[var(--text-primary)] shadow-[0_1px_0_rgba(148,178,214,0.22)] backdrop-blur-xl backdrop-saturate-150',
        className,
      )}
    >
      {/* 左侧：装饰性系统标志与应用菜单项 */}
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          aria-hidden="true"
          className="inline-flex size-3.5 items-center justify-center rounded-[4px] bg-[linear-gradient(145deg,#3b93ff,#1677ff)] text-[9px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
        >
          G
        </span>
        <span className="truncate font-semibold tracking-tight text-[var(--text-primary)]">
          {appName}
        </span>
        <div className="hidden items-center gap-3 sm:flex">
          {MENU_ITEMS.map((item) => (
            <span
              key={item}
              className="rounded px-1 py-0.5 text-[11.5px] font-medium text-[var(--text-primary)]/85 transition-colors hover:bg-white/55"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* 右侧：Wi-Fi、系统状态与时间 */}
      <div className="flex shrink-0 items-center gap-3 text-[11px] font-medium text-[var(--text-primary)]/88">
        <span
          className="inline-flex items-center gap-1"
          role="img"
          title="Wi-Fi 已连接"
          aria-label="Wi-Fi 已连接"
        >
          <Wifi
            className="size-3.5 text-[var(--text-primary)]/80"
            aria-hidden="true"
          />
        </span>
        <span
          className="hidden items-center gap-1 sm:inline-flex"
          title={statusLabel}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              healthy ? 'bg-[var(--success)]' : 'bg-[var(--warning)]',
            )}
          />
          <ShieldCheck
            className={cn(
              'size-3.5',
              healthy ? 'text-[#116b3b]' : 'text-[#8a5000]',
            )}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
        </span>
        <time
          data-dynamic="clock"
          className="tabular-nums font-medium text-[var(--text-primary)]"
        >
          {clock}
        </time>
      </div>
    </div>
  );
}
