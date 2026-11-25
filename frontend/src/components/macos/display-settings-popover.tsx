import { useEffect, useId, useRef } from 'react';
import { AlignJustify, AppWindow, Sparkles, Waves } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavigationOpacitySlider } from './navigation-opacity-slider';

export const DISPLAY_SETTINGS_STORAGE_KEY = 'gm_display_settings';
export const DISPLAY_SETTINGS_SYNC_EVENT = 'gm:display-settings-change';

export type DisplaySettingsState = {
  flowingBackground: boolean;
  animationsEnabled: boolean;
  compactMode: boolean;
};

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettingsState = {
  flowingBackground: true,
  animationsEnabled: true,
  compactMode: false,
};

export function readDisplaySettings(): DisplaySettingsState {
  try {
    const raw = window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DisplaySettingsState>;
    return {
      flowingBackground:
        typeof parsed.flowingBackground === 'boolean'
          ? parsed.flowingBackground
          : DEFAULT_DISPLAY_SETTINGS.flowingBackground,
      animationsEnabled:
        typeof parsed.animationsEnabled === 'boolean'
          ? parsed.animationsEnabled
          : DEFAULT_DISPLAY_SETTINGS.animationsEnabled,
      compactMode:
        typeof parsed.compactMode === 'boolean'
          ? parsed.compactMode
          : DEFAULT_DISPLAY_SETTINGS.compactMode,
    };
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

export function persistDisplaySettings(settings: DisplaySettingsState): void {
  try {
    window.localStorage.setItem(
      DISPLAY_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    /* 浏览器隐私模式可能禁用存储，静默降级为会话内生效。 */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<DisplaySettingsState>(DISPLAY_SETTINGS_SYNC_EVENT, {
        detail: settings,
      }),
    );
  }
}

export function subscribeDisplaySettings(
  onUpdate: (settings: DisplaySettingsState) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DISPLAY_SETTINGS_STORAGE_KEY) {
      onUpdate(readDisplaySettings());
    }
  };
  const handleSync = (event: Event) => {
    const detail = (event as CustomEvent<DisplaySettingsState>).detail;
    if (detail) onUpdate(detail);
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(DISPLAY_SETTINGS_SYNC_EVENT, handleSync);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(DISPLAY_SETTINGS_SYNC_EVENT, handleSync);
  };
}

export function MacSwitch({
  id,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-[40px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-[180ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        checked
          ? 'border-[#1268e6]/30 bg-[linear-gradient(180deg,#2f8bff_0%,#1677ff_100%)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.28)]'
          : 'border-[#b9cadf]/70 bg-[#d5e1ee]/90 shadow-[inset_0_1px_2px_rgba(32,64,110,0.12)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block size-[20px] rounded-full bg-white shadow-[0_1px_3px_rgba(23,32,51,0.28),0_0_0_0.5px_rgba(255,255,255,0.85)] transition-transform duration-[180ms] ease-out',
          checked ? 'translate-x-[17px]' : 'translate-x-[1px]',
        )}
      />
    </button>
  );
}

export function DisplaySettingsPopover({
  open,
  onClose,
  triggerRef,
  navAlpha,
  onNavAlphaChange,
  settings,
  onSettingsChange,
  className,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  navAlpha: number;
  onNavAlphaChange: (next: number) => void;
  settings: DisplaySettingsState;
  onSettingsChange: (next: DisplaySettingsState) => void;
  className?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bgSwitchId = useId();
  const animSwitchId = useId();
  const compactSwitchId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef?.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        triggerRef?.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  const toggleItems: {
    id: string;
    label: string;
    key: keyof DisplaySettingsState;
    icon: typeof Waves;
  }[] = [
    {
      id: bgSwitchId,
      label: '使用流动背景',
      key: 'flowingBackground',
      icon: Waves,
    },
    {
      id: animSwitchId,
      label: '界面动画效果',
      key: 'animationsEnabled',
      icon: Sparkles,
    },
    {
      id: compactSwitchId,
      label: '紧凑模式',
      key: 'compactMode',
      icon: AlignJustify,
    },
  ];

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-labelledby={titleId}
      data-slot="display-settings-popover"
      className={cn(
        'absolute top-full right-0 z-50 mt-2.5 w-[360px] max-w-[calc(100vw-2rem)] rounded-[18px] border border-white/95 bg-[rgba(253,254,255,0.96)] p-4 text-[var(--text-primary)] shadow-[0_22px_56px_rgba(32,68,118,0.22),0_4px_16px_rgba(32,68,118,0.1),inset_0_1px_0_rgba(255,255,255,1)] backdrop-blur-[32px] backdrop-saturate-150',
        className,
      )}
    >
      {/* 顶部指向设置按钮的玻璃小尖角 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1.5 right-3.5 size-3 rotate-45 rounded-[2px] border-t border-l border-white/95 bg-[rgba(253,254,255,0.98)]"
      />
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 border-b border-[var(--table-divider)] pb-3">
        <AppWindow
          className="size-4 text-[var(--text-secondary)]"
          aria-hidden="true"
        />
        <h2
          id={titleId}
          className="text-[13.5px] font-semibold tracking-tight text-[var(--text-primary)]"
        >
          界面与显示
        </h2>
      </div>

      {/* 导航栏毛玻璃透明度滑块（复用 NavigationOpacitySlider） */}
      <div className="border-b border-[var(--table-divider)] py-3.5">
        <NavigationOpacitySlider
          variant="popover"
          value={navAlpha}
          onChange={onNavAlphaChange}
        />
      </div>

      {/* macOS 风格显示开关 */}
      <div className="space-y-3 pt-3.5">
        {toggleItems.map(({ id, label, key, icon: Icon }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <label
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2.5 text-[13px] font-medium text-[var(--text-primary)] select-none"
            >
              <Icon
                className="size-4 shrink-0 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>{label}</span>
            </label>
            <MacSwitch
              id={id}
              checked={settings[key]}
              onCheckedChange={(checked) =>
                onSettingsChange({ ...settings, [key]: checked })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
