import { cn } from '@/lib/utils';

export function GmailMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dimensions =
    size === 'sm' ? 'size-[18px]' : size === 'lg' ? 'size-10' : 'size-7';
  return (
    <svg
      viewBox="0 0 28 22"
      fill="none"
      aria-hidden="true"
      className={cn(dimensions, 'shrink-0', className)}
    >
      <rect
        x="1"
        y="1"
        width="26"
        height="20"
        rx="4"
        fill="#FFFFFF"
        fillOpacity="0.92"
      />
      <path
        d="M2.5 5.2V18.5C2.5 19.6 3.4 20.5 4.5 20.5H7.2V11.2L2.5 5.2Z"
        fill="#4285F4"
      />
      <path
        d="M25.5 5.2V18.5C25.5 19.6 24.6 20.5 23.5 20.5H20.8V11.2L25.5 5.2Z"
        fill="#34A853"
      />
      <path
        d="M20.8 11.2V2.6L23.1 1.6C24.5 1 25.5 2 25.5 3.4V5.2L20.8 11.2Z"
        fill="#FBBC04"
      />
      <path
        d="M7.2 11.2L14 16.3L20.8 11.2V2.6L14 7.7L7.2 2.6V11.2Z"
        fill="#EA4335"
      />
      <path
        d="M2.5 5.2V3.4C2.5 2 3.5 1 4.9 1.6L7.2 2.6V11.2L2.5 5.2Z"
        fill="#C5221F"
      />
    </svg>
  );
}
