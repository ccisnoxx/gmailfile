import * as React from 'react';
import { cn } from '@/lib/utils';

export function AppWindowShell({
  navAlpha,
  menuBar,
  toolbar,
  sidebar,
  children,
  className,
  outerClassName,
  mainClassName,
  flowingBackground = true,
  animationsEnabled = true,
  compactMode = false,
}: {
  navAlpha: number;
  menuBar?: React.ReactNode;
  toolbar: React.ReactNode;
  sidebar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  outerClassName?: string;
  mainClassName?: string;
  flowingBackground?: boolean;
  animationsEnabled?: boolean;
  compactMode?: boolean;
}) {
  const windowStyle = {
    '--nav-alpha': String(navAlpha / 100),
  } as React.CSSProperties;

  return (
    <div
      data-flowing-bg={flowingBackground ? 'true' : 'false'}
      data-animations={animationsEnabled ? 'true' : 'false'}
      data-compact={compactMode ? 'true' : 'false'}
      className={cn(
        'macos-desktop-bg relative min-h-screen w-full overflow-x-clip',
        menuBar
          ? 'px-3 pt-9 pb-4 sm:px-5 sm:pt-10 sm:pb-6 lg:px-8 lg:pt-11 lg:pb-7'
          : 'px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-7',
        outerClassName,
      )}
    >
      {menuBar}
      {/* 纯矢量柔和抽象光斑与波浪层，模拟 macOS 淡蓝通透桌面景深 */}
      {flowingBackground && (
        <svg
          aria-hidden="true"
          data-slot="flowing-background"
          viewBox="0 0 1728 1117"
          preserveAspectRatio="xMidYMid slice"
          className={cn(
            'pointer-events-none fixed inset-0 h-full w-full opacity-90',
            animationsEnabled && 'macos-flowing-bg',
          )}
        >
          <defs>
            <linearGradient id="gm-wave-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.52" />
              <stop offset="55%" stopColor="#9AC8FF" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#70B0FF" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="gm-wave-2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#65A8FF" stopOpacity="0.34" />
              <stop offset="50%" stopColor="#B8DBFF" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
            </linearGradient>
            <radialGradient id="gm-orb-1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="260" cy="180" rx="460" ry="320" fill="url(#gm-orb-1)" />
          <path
            d="M-120 740 C 260 540, 620 960, 1080 620 C 1380 400, 1580 560, 1880 340 L 1880 1200 L -120 1200 Z"
            fill="url(#gm-wave-1)"
          />
          <path
            d="M420 -80 C 740 240, 1140 60, 1460 390 C 1640 570, 1780 610, 1900 560 L 1900 -120 Z"
            fill="url(#gm-wave-2)"
          />
        </svg>
      )}

      <div
        style={windowStyle}
        data-slot="app-window-shell"
        className={cn(
          'macos-window relative z-10 mx-auto flex w-full max-w-[1520px] flex-col overflow-hidden text-[var(--text-primary)]',
          menuBar ? 'min-h-[calc(100vh-4.5rem)]' : 'min-h-[calc(100vh-3.5rem)]',
          className,
        )}
      >
        {toolbar}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {sidebar}
          <main
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-5 p-5 lg:p-6',
              mainClassName,
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
