import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS, type SettingsSectionKey } from './types';

export function SettingsSegmentedTabs({
  activeSection,
  onChange,
  className,
}: {
  activeSection: SettingsSectionKey;
  onChange: (section: SettingsSectionKey) => void;
  className?: string;
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = (index: number) => {
    const next = SETTINGS_SECTIONS[index];
    if (!next) return;
    onChange(next.key);
    buttonRefs.current[index]?.focus();
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab((index + 1) % SETTINGS_SECTIONS.length);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(
        (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(SETTINGS_SECTIONS.length - 1);
    }
  };

  return (
    <div
      data-slot="settings-segmented-tabs"
      className={cn(
        'macos-thin-scrollbar flex w-full overflow-x-auto pb-0.5',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label="系统设置分类"
        className="inline-flex min-w-max items-center gap-1 rounded-[14px] border border-white/80 bg-white/46 p-1 shadow-[inset_0_1px_2px_rgba(45,86,138,0.08),0_4px_14px_rgba(45,86,138,0.05)] backdrop-blur-md"
      >
        {SETTINGS_SECTIONS.map((section, index) => {
          const active = activeSection === section.key;
          return (
            <button
              key={section.key}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              id={`settings-tab-${section.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`settings-tabpanel-${section.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(section.key)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                'inline-flex h-[34px] items-center justify-center rounded-[10px] px-4 text-[13px] whitespace-nowrap transition-all duration-[180ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                active
                  ? 'border border-white/45 bg-[linear-gradient(180deg,rgba(47,139,255,0.92),rgba(22,119,255,0.96))] font-semibold text-white shadow-[0_5px_14px_rgba(22,119,255,0.28),inset_0_1px_0_rgba(255,255,255,0.38)]'
                  : 'font-medium text-[var(--text-secondary)] hover:bg-white/60 hover:text-[var(--text-primary)]',
              )}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
