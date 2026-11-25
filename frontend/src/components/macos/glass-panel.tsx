import * as React from 'react';
import { cn } from '@/lib/utils';

export function GlassPanel({
  variant = 'default',
  interactive = false,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'strong';
  interactive?: boolean;
}) {
  return (
    <div
      data-slot="glass-panel"
      className={cn(
        'macos-glass-panel',
        variant === 'strong' && 'macos-glass-panel-strong',
        interactive && 'macos-glass-interactive',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
