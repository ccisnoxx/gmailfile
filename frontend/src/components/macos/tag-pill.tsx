import { cn } from '@/lib/utils';

export type TagTone = 'blue' | 'purple' | 'green' | 'yellow' | 'gray';

const toneClasses: Record<TagTone, string> = {
  blue: 'bg-[#e8f2ff] text-[#0f52ba] border-[#1677ff]/18',
  purple: 'bg-[#efeafd] text-[#5637cf] border-[#8468f5]/20',
  green: 'bg-[#e6f7ee] text-[#116b3b] border-[#2fbf71]/22',
  yellow: 'bg-[#fef6df] text-[#8a5000] border-[#f5a623]/25',
  gray: 'bg-[#eef2f6] text-[#475467] border-[#98a2b3]/25',
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
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        toneClasses[resolved],
        className,
      )}
    >
      {name}
    </span>
  );
}
