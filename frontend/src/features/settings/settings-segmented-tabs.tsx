import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS, type SettingsSectionKey } from './types';

export function SettingsSegmentedTabs({
  activeSection,
  onChange,
  onPreloadSection,
  className,
}: {
  activeSection: SettingsSectionKey;
  onChange: (section: SettingsSectionKey) => void;
  onPreloadSection?: (section: SettingsSectionKey) => void;
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
        className="inline-flex min-w-max items-center gap-1 rounded-[14px] border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-1 backdrop-blur-md"
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
              onMouseEnter={() => onPreloadSection?.(section.key)}
              onFocus={() => onPreloadSection?.(section.key)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                'inline-flex h-[34px] items-center justify-center rounded-[10px] px-3 text-[12.5px] whitespace-nowrap transition-all duration-[180ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:px-4 sm:text-[13px]',
                active
                  ? 'bg-[var(--accent)] font-semibold text-[var(--primary-foreground)] shadow-[0_5px_14px_rgba(22,119,255,0.28)]'
                  : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]',
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
