import { ArrowUpRight, Clock } from 'lucide-react';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';

export type ActivityTimelineItem = {
  id: string;
  title: string;
  timestamp: string;
  source?: string;
};

export function ActivityTimeline({
  items,
  onViewFullLog,
  className,
}: {
  items: ActivityTimelineItem[];
  onViewFullLog?: () => void;
  className?: string;
}) {
  return (
    <GlassPanel
      variant="strong"
      data-slot="activity-timeline"
      aria-label="活动时间线"
      className={cn(
        'min-w-0 rounded-[18px] p-[var(--detail-pad,20px)]',
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            活动时间线
          </h2>
        </div>
        {onViewFullLog && (
          <button
            type="button"
            onClick={onViewFullLog}
            className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            <span>查看完整日志</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">暂无活动记录</p>
      ) : (
        <ol className="relative space-y-3.5 pl-4">
          {/* 细蓝色时间轴线 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2 bottom-2 left-[5px] w-[1.5px] bg-gradient-to-b from-[#1677ff]/65 via-[#1677ff]/28 to-[#1677ff]/12"
          />
          {items.map((item, idx) => {
            const isLatest = idx === 0;
            return (
              <li
                key={item.id}
                className="relative flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[12.5px]"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-1.5 -left-[15px] rounded-full',
                    isLatest
                      ? 'size-2.5 bg-[var(--accent)] ring-4 ring-[#1677ff]/15'
                      : 'ml-[1px] size-2 bg-[#93beff] ring-2 ring-white/80',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 leading-snug',
                    isLatest
                      ? 'font-medium text-[var(--text-primary)]'
                      : 'text-[var(--text-primary)]/85',
                  )}
                >
                  {item.title}
                </span>
                <time className="shrink-0 text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                  {item.timestamp}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </GlassPanel>
  );
}
