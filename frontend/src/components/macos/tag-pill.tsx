import { cn } from '@/lib/utils';

export type TagTone = 'blue' | 'purple' | 'green' | 'yellow' | 'gray';

const toneClasses: Record<TagTone, string> = {
  blue: 'bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)] border-[var(--badge-blue-border)]',
  purple:
    'bg-[var(--badge-purple-bg)] text-[var(--badge-purple-text)] border-[var(--badge-purple-border)]',
  green:
    'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)] border-[var(--badge-green-border)]',
  yellow:
    'bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)] border-[var(--badge-orange-border)]',
  gray: 'bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)] border-[var(--badge-gray-border)]',
};

const cycleTones: readonly TagTone[] = ['blue', 'purple', 'green', 'yellow'];

export function resolveTagTone(name: string): TagTone {
  if (name.includes('开发')) return 'purple';
  if (name.includes('测试')) return 'blue';
  if (name.includes('工具')) return 'green';
  if (name.includes('长期')) return 'yellow';
  if (name.includes('归档') || name.includes('停用')) return 'gray';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return cycleTones[hash % cycleTones.length];
}

export function TagPill({
  name,
  tone,
  className,
}: {
  name: string;
  tone?: TagTone;
  className?: string;
}) {
  const resolved = tone ?? resolveTagTone(name);
  return (
    <span
      data-slot="tag-pill"
      title={name}
      className={cn(
        'inline-flex max-w-[140px] items-center truncate rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        toneClasses[resolved],
        className,
      )}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}
