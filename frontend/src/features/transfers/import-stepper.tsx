import { Check } from 'lucide-react';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';
import type { ImportStep } from './types';

type StepMeta = {
  step: ImportStep;
  title: string;
  description: string;
};

const STEPS: readonly StepMeta[] = [
  {
    step: 1,
    title: '上传文件',
    description: '拖放或选择 UTF-8 CSV 并校验结构',
  },
  {
    step: 2,
    title: '配置映射',
    description: '匹配系统字段、导入策略与冲突规则',
  },
  {
    step: 3,
    title: '数据预览',
    description: '筛查有效、警告与错误记录明细',
  },
  {
    step: 4,
    title: '确认导入',
    description: '原子事务提交并写入防篡改审计日志',
  },
];

export function ImportStepper({
  currentStep,
  completedSteps,
  canJumpToStep,
  onSelectStep,
  className,
}: {
  currentStep: ImportStep;
  completedSteps: readonly ImportStep[];
  canJumpToStep?: (step: ImportStep) => boolean;
  onSelectStep?: (step: ImportStep) => void;
  className?: string;
}) {
  const completedSet = new Set(completedSteps);

  return (
    <GlassPanel
      data-slot="import-stepper"
      className={cn('px-4 py-3.5 sm:px-5', className)}
    >
      <nav aria-label="CSV 导入步骤">
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-4 md:gap-0">
          {STEPS.map((item, idx) => {
            const isActive = currentStep === item.step;
            const isCompleted = completedSet.has(item.step) && !isActive;
            const clickable =
              Boolean(onSelectStep) &&
              (canJumpToStep ? canJumpToStep(item.step) : true);
            const isLast = idx === STEPS.length - 1;
            const connectorActive =
              completedSet.has(item.step) || currentStep > item.step;

            return (
              <li
                key={item.step}
                data-step={item.step}
                data-state={
                  isActive ? 'active' : isCompleted ? 'completed' : 'pending'
                }
                className="relative flex items-center"
              >
                <button
                  type="button"
                  disabled={!clickable}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => clickable && onSelectStep?.(item.step)}
                  className={cn(
                    'group flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors duration-[180ms] ease-out',
                    clickable
                      ? 'cursor-pointer hover:bg-white/50'
                      : 'cursor-default opacity-75',
                    isActive && 'bg-[#1677ff]/[0.07]',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums transition-all duration-[180ms] ease-out',
                      isCompleted
                        ? 'border-[#2fbf71]/35 bg-[#e7f8ef] text-[#1b8a4e]'
                        : isActive
                          ? 'border-[var(--accent)] bg-[#eaf3ff] text-[var(--accent)] ring-4 ring-[#1677ff]/12'
                          : 'border-[#c6d8ee] bg-white/70 text-[var(--text-secondary)]',
                    )}
                  >
                    {isCompleted ? (
                      <Check className="size-3.5 stroke-[2.5]" />
                    ) : (
                      item.step
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[13px] leading-tight font-semibold',
                        isActive
                          ? 'text-[#1158c7]'
                          : isCompleted
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)]',
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-[var(--text-secondary)]">
                      {item.description}
                    </span>
                  </span>
                </button>

                {/* 步骤间细线连接器 */}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mx-1 hidden h-[1.5px] w-4 shrink-0 rounded-full transition-colors md:block xl:w-6',
                      connectorActive ? 'bg-[#1677ff]/42' : 'bg-[#94b2d6]/35',
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </GlassPanel>
  );
}
