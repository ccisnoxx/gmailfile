import * as React from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import type { SidebarSystemStatus } from './primary-sidebar';

export type PersistentSidebarMeta = {
  trashCount?: number;
  systemStatus?: SidebarSystemStatus;
};

type AppShellContextValue = {
  hasSidebar: boolean;
  persistentShell: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  pushNotification?: (message: string) => void;
  openCommandPalette?: () => void;
  syncSidebarMeta?: (meta: PersistentSidebarMeta) => void;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShellContext() {
  return useContext(AppShellContext);
}

export function AppWindowShell({
  navAlpha,
  toolbar,
  sidebar,
  mobileDrawerHeader,
  children,
  className,
  outerClassName,
  mainClassName,
  flowingBackground = true,
  animationsEnabled = true,
  compactMode = false,
  persistentShell = false,
  onPushNotification,
  onOpenCommandPalette,
  onSyncSidebarMeta,
}: {
  navAlpha: number;
  menuBar?: React.ReactNode;
  toolbar: React.ReactNode;
  sidebar?: React.ReactNode;
  mobileDrawerHeader?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  outerClassName?: string;
  mainClassName?: string;
  flowingBackground?: boolean;
  animationsEnabled?: boolean;
  compactMode?: boolean;
  persistentShell?: boolean;
  onPushNotification?: (message: string) => void;
  onOpenCommandPalette?: () => void;
  onSyncSidebarMeta?: (meta: PersistentSidebarMeta) => void;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const hasSidebar = Boolean(sidebar || mobileDrawerHeader);

  const shellContext = useMemo<AppShellContextValue>(
    () => ({
      hasSidebar,
      persistentShell,
      mobileSidebarOpen,
      setMobileSidebarOpen,
      toggleMobileSidebar: () => setMobileSidebarOpen((open) => !open),
      closeMobileSidebar: () => setMobileSidebarOpen(false),
      pushNotification: onPushNotification,
      openCommandPalette: onOpenCommandPalette,
      syncSidebarMeta: onSyncSidebarMeta,
    }),
    [
      hasSidebar,
      mobileSidebarOpen,
      onOpenCommandPalette,
      onPushNotification,
      onSyncSidebarMeta,
      persistentShell,
    ],
  );

  const windowStyle = {
    '--nav-alpha': String(navAlpha / 100),
  } as React.CSSProperties;

  return (
    <AppShellContext.Provider value={shellContext}>
      <div
        data-flowing-bg={flowingBackground ? 'true' : 'false'}
        data-animations={animationsEnabled ? 'true' : 'false'}
        data-compact={compactMode ? 'true' : 'false'}
        className={cn(
          'macos-desktop-bg relative min-h-screen w-full overflow-x-clip',
          outerClassName,
        )}
      >
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
              <linearGradient
                id="gm-wave-1"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.68" />
                <stop offset="50%" stopColor="#6DB2FF" stopOpacity="0.46" />
                <stop offset="100%" stopColor="#3B8BFF" stopOpacity="0.18" />
              </linearGradient>
              <linearGradient
                id="gm-wave-2"
                x1="100%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#4A98FF" stopOpacity="0.52" />
                <stop offset="50%" stopColor="#8EC4FF" stopOpacity="0.38" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
              </linearGradient>
              <radialGradient id="gm-orb-1" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.82" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="gm-orb-2" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#5AA4FF" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#5AA4FF" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse
              cx="260"
              cy="180"
              rx="480"
              ry="340"
              fill="url(#gm-orb-1)"
            />
            <ellipse
              cx="1440"
              cy="210"
              rx="520"
              ry="340"
              fill="url(#gm-orb-2)"
            />
            <path
              d="M-120 700 C 260 480, 620 920, 1080 560 C 1380 340, 1580 520, 1880 280 L 1880 1200 L -120 1200 Z"
              fill="url(#gm-wave-1)"
            />
            <path
              d="M360 -80 C 700 260, 1120 60, 1440 390 C 1640 570, 1780 610, 1900 540 L 1900 -120 Z"
              fill="url(#gm-wave-2)"
            />
          </svg>
        )}

        <div
          style={windowStyle}
          data-slot="app-window-shell"
          className={cn(
            'macos-window relative z-10 flex min-h-screen w-full flex-col overflow-x-clip text-[var(--text-primary)]',
            className,
          )}
        >
          {toolbar}

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* 桌面端（>=1024px）左侧固定侧边栏；移动端收纳入抽屉避免首屏被导航占满 */}
            {sidebar && (
              <div className="hidden lg:flex lg:shrink-0">{sidebar}</div>
            )}

            <main
              className={cn(
                'flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-6',
                mainClassName,
              )}
            >
              {children}
            </main>
          </div>
        </div>

        {/* 移动端 / 平板竖屏侧边栏抽屉（<1024px）：采用 Radix Sheet 保证 Focus Trap、inert 与关闭焦点恢复 */}
        {hasSidebar && (
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent
              side="left"
              data-slot="mobile-sidebar-drawer"
              aria-label="导航菜单"
              style={windowStyle}
              className="macos-glass-modal flex h-full w-[min(300px,85vw)] max-w-none flex-col gap-0 overflow-y-auto border-r border-[var(--nav-divider)] bg-[var(--surface-popover)] p-0 shadow-2xl lg:hidden"
            >
              <SheetHeader className="border-b border-[var(--nav-divider)] px-4 py-3 text-left">
                <SheetTitle className="text-[13.5px] font-semibold text-[var(--text-primary)]">
                  导航菜单
                </SheetTitle>
                <SheetDescription className="sr-only">
                  切换概览、账号、关系、数据操作与系统设置视图
                </SheetDescription>
              </SheetHeader>
              {mobileDrawerHeader && (
                <div
                  className="border-b border-[var(--nav-divider)] p-3"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a')) {
                      setMobileSidebarOpen(false);
                    }
                  }}
                >
                  {mobileDrawerHeader}
                </div>
              )}
              {sidebar && (
                <div
                  className="flex-1"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a')) {
                      setMobileSidebarOpen(false);
                    }
                  }}
                >
                  {sidebar}
                </div>
              )}
            </SheetContent>
          </Sheet>
        )}
      </div>
    </AppShellContext.Provider>
  );
}
