import { cn } from '@/lib/utils';

export function MacTrafficLights({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-2', className)}
      aria-hidden="true"
    >
      <span className="size-3 rounded-full border border-[#e0443e]/50 bg-[#ff5f57] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
      <span className="size-3 rounded-full border border-[#dea123]/50 bg-[#febc2e] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
      <span className="size-3 rounded-full border border-[#1aab29]/50 bg-[#28c840] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
    </div>
  );
}
