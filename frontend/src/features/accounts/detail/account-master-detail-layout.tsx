import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ChevronUp, Home, List } from 'lucide-react';
import {
  AppWindowShell,
  GlassToolbar,
  PrimarySidebar,
  useAppShellContext,
  type DisplaySettingsState,
  type SidebarCounts,
  type SidebarSectionKey,
  type SidebarSystemStatus,
  type SidebarTagItem,
  type TopNavKey,
  type WorkspaceNavKey,
} from '@/components/macos';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export function AccountMasterDetailLayout({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  displaySettingsOpen,
  onDisplaySettingsOpenChange,
  activeNav = 'accounts',
  onSelectNav,
  onSelectSection,
  onSelectTag,
  onAddTag,
  sidebarCounts,
  sidebarTags,
  trashCount = 0,
  systemStatus,
  notifications = [],
  onOpenSecurity,
  onOpenRecoveryUsage,
  onLogout,
  onNavigateAccountsList,
  breadcrumbCurrent = '账号详情',
  positionLabel,
  onSelectPrev,
  onSelectNext,
  listPane,
  detailContent,
  toastMessage,
}: {
  navAlpha: number;
  onNavAlphaChange: (value: number) => void;
  displaySettings: DisplaySettingsState;
  onDisplaySettingsChange: (next: DisplaySettingsState) => void;
  displaySettingsOpen: boolean;
  onDisplaySettingsOpenChange: (open: boolean) => void;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  activeNav?: WorkspaceNavKey;
  onSelectNav: (key: WorkspaceNavKey) => void;
  onSelectSection?: (section: SidebarSectionKey) => void;
  onSelectTag?: (tagId: string) => void;
  onAddTag?: () => void;
  sidebarCounts?: SidebarCounts;
  sidebarTags?: SidebarTagItem[];
  trashCount?: number;
  systemStatus?: SidebarSystemStatus;
  notifications?: string[];
  onOpenSecurity: () => void;
  onOpenOperations?: () => void;
  onOpenRecoveryUsage?: () => void;
  onLogout: () => void;
  onNavigateAccountsList: () => void;
  breadcrumbCurrent?: string;
  positionLabel?: string;
  onSelectPrev?: () => void;
  onSelectNext?: () => void;
  listPane: React.ReactNode;
  detailContent: React.ReactNode;
  toastMessage?: string;
}) {
  const shell = useAppShellContext();
  const inPersistentShell = Boolean(shell?.persistentShell);
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const mapTopNav = (key: TopNavKey) => {
    if (key === 'accounts' || key === 'dashboard') {
      onNavigateAccountsList();
      return;
    }
    onSelectNav(key);
  };

  const toolbar = (
    <GlassToolbar
      activeNav="accounts"
      navAlpha={navAlpha}
      onNavAlphaChange={onNavAlphaChange}
      displaySettings={displaySettings}
      onDisplaySettingsChange={onDisplaySettingsChange}
      displaySettingsOpen={displaySettingsOpen}
      onDisplaySettingsOpenChange={onDisplaySettingsOpenChange}
      onSelectNav={mapTopNav}
      onOpenSecurity={onOpenSecurity}
      onOpenRecoveryUsage={onOpenRecoveryUsage}
      onOpenTransfer={() => onSelectNav('transfer')}
      onLogout={onLogout}
      notifications={notifications}
    />
  );

  const masterDetailBody = (
    <>
      {/* 宽屏（>=1280px）左侧常驻列表栏；中窄屏收拢进抽屉以保障详情首屏完整 */}
      <div className="hidden xl:flex xl:shrink-0">{listPane}</div>

      {/* 右侧栏：面包屑 / 窄屏队列切换条 + 账号详情 */}
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--detail-gap,16px)]">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <nav
            aria-label="面包屑导航"
            className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]"
          >
            <button
              type="button"
              aria-label="返回账号管理"
              onClick={onNavigateAccountsList}
              className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
            >
              <Home className="size-3.5" aria-hidden="true" />
            </button>
            <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
            <button
              type="button"
              onClick={onNavigateAccountsList}
              className="inline-flex min-h-6 items-center rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--accent-text)]"
            >
              Gmail 账号
            </button>
            <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
            <span
              aria-current="page"
              className="truncate font-semibold text-[var(--text-primary)]"
            >
              {breadcrumbCurrent}
            </span>
          </nav>

          {/* 队列上下条切换与 <1280px 展开队列抽屉 */}
          <div className="flex items-center gap-1.5 text-xs">
            {positionLabel && (
              <span className="rounded-lg bg-[var(--surface-control)] px-2 py-1 tabular-nums text-[11.5px] font-medium text-[var(--text-secondary)]">
                {positionLabel}
              </span>
            )}
            {(onSelectPrev || onSelectNext) && (
              <div className="inline-flex items-center rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-0.5">
                <button
                  type="button"
                  aria-label="上一条账号"
                  disabled={!onSelectPrev}
                  onClick={onSelectPrev}
                  className="inline-flex size-7 items-center justify-center rounded-lg text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-control-hover)] disabled:opacity-40"
                >
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="下一条账号"
                  disabled={!onSelectNext}
                  onClick={onSelectNext}
                  className="inline-flex size-7 items-center justify-center rounded-lg text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-control-hover)] disabled:opacity-40"
                >
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setQueueDrawerOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-control-hover)] xl:hidden"
            >
              <List className="size-3.5" aria-hidden="true" />
              <span>账号队列</span>
            </button>
          </div>
        </div>

        {detailContent}
      </div>

      {/* 中窄屏（<1280px）账号队列抽屉 */}
      <Sheet open={queueDrawerOpen} onOpenChange={setQueueDrawerOpen}>
        <SheetContent
          side="left"
          className="macos-glass-modal flex w-[min(340px,88vw)] max-w-none flex-col gap-0 overflow-hidden p-3 xl:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>当前筛选账号队列</SheetTitle>
            <SheetDescription>切换查看队列中的其他账号</SheetDescription>
          </SheetHeader>
          <div
            className="flex min-h-0 flex-1 flex-col"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-account-item]')) {
                setQueueDrawerOpen(false);
              }
            }}
          >
            {listPane}
          </div>
        </SheetContent>
      </Sheet>

      {/* 轻量玻璃 Toast（Portal 渲染于 body，z-[70] 确保位于确认弹窗之上不被遮挡） */}
      {toastMessage &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            data-slot="detail-toast"
            className="pointer-events-none fixed right-6 bottom-6 z-[70] flex max-w-[min(28rem,calc(100vw-3rem))] items-center gap-2 rounded-2xl border border-[var(--modal-border)] bg-[var(--surface-toast)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_14px_38px_rgba(15,30,58,0.28)] backdrop-blur-xl"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-[var(--accent)]"
            />
            <span>{toastMessage}</span>
          </div>,
          document.body,
        )}
    </>
  );

  if (inPersistentShell) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--detail-gap,16px)] xl:flex-row">
        {masterDetailBody}
      </div>
    );
  }

  return (
    <AppWindowShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      toolbar={toolbar}
      sidebar={
        <PrimarySidebar
          mode="workspace"
          activeNav={activeNav}
          counts={sidebarCounts}
          tags={sidebarTags}
          trashCount={trashCount}
          systemStatus={systemStatus}
          onSelectNav={onSelectNav}
          onSelectSection={onSelectSection}
          onSelectTag={onSelectTag}
          onAddTag={onAddTag}
        />
      }
      mainClassName="flex-col gap-[var(--detail-gap,16px)] p-3.5 xl:flex-row lg:p-4"
    >
      {masterDetailBody}
    </AppWindowShell>
  );
}
