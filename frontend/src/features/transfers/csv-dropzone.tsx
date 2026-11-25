import { useId, useRef, useState } from 'react';
import { AlertCircle, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAX_CSV_BYTES } from './csv-parser';

function isCsvFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  return (
    lower.endsWith('.csv') ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel'
  );
}

export function CsvDropzone({
  onFileSelected,
  disabled = false,
  compact = false,
  onLoadSample,
  clientNotice,
  className,
}: {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
  onLoadSample?: () => void;
  clientNotice?: string;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleCandidateFile = (file: File | undefined) => {
    setLocalError('');
    if (!file) return;
    if (!isCsvFile(file)) {
      setLocalError('仅支持上传 text/csv（.csv）格式文件。');
      return;
    }
    if (file.size === 0) {
      setLocalError('文件内容为空，请选择有效的 CSV 文件。');
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setLocalError('文件大小超过 10 MB 限制，请拆分后再上传。');
      return;
    }
    onFileSelected(file);
  };

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const activeError = localError || clientNotice;

  return (
    <div data-slot="csv-dropzone" className={cn('space-y-2.5', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="拖拽 CSV 文件到此处，或按回车选择文件"
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled && !dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          if (disabled) return;
          const file = event.dataTransfer.files?.[0];
          handleCandidateFile(file);
        }}
        className={cn(
          'flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed text-center transition-all duration-[180ms] ease-out outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
          compact ? 'px-4 py-4' : 'px-4 py-6',
          disabled
            ? 'cursor-not-allowed border-[#b9cde6]/60 bg-white/32 opacity-65'
            : dragging
              ? 'cursor-copy border-[var(--accent)] bg-[#eaf3ff]/75 shadow-[0_0_0_4px_rgba(22,119,255,0.12)]'
              : 'cursor-pointer border-[#99bce6]/80 bg-white/44 hover:border-[var(--accent)]/75 hover:bg-white/66',
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          aria-label="选择 CSV 文件"
          className="sr-only"
          onClick={(e) => {
            e.stopPropagation();
          }}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            handleCandidateFile(picked);
            // 允许重复选择同名文件
            event.target.value = '';
          }}
        />

        <span
          aria-hidden="true"
          className={cn(
            'inline-flex items-center justify-center rounded-2xl border border-[#1677ff]/20 bg-[#eaf3ff]/90 text-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]',
            compact ? 'mb-2 size-10' : 'mb-3 size-12',
          )}
        >
          {dragging ? (
            <UploadCloud className={compact ? 'size-5' : 'size-6'} />
          ) : (
            <FileSpreadsheet className={compact ? 'size-5' : 'size-6'} />
          )}
        </span>

        <p className="text-[13px] font-medium text-[var(--text-primary)]">
          拖拽 CSV 文件到此处，或
        </p>

        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              openPicker();
            }}
            className="inline-flex h-8 items-center rounded-xl border border-[#1677ff]/25 bg-[linear-gradient(180deg,rgba(64,150,255,0.92),rgba(22,119,255,0.95))] px-3.5 text-[12.5px] font-medium text-white shadow-[0_4px_12px_rgba(22,119,255,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] transition-all duration-[180ms] ease-out hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
          >
            选择文件…
          </button>
          {onLoadSample && (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                setLocalError('');
                onLoadSample();
              }}
              className="inline-flex h-8 items-center rounded-xl border border-white/85 bg-white/72 px-3 text-[12px] font-medium text-[var(--accent)] transition-colors hover:bg-white disabled:opacity-55"
            >
              加载示例文件
            </button>
          )}
        </div>

        <p className="mt-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          限制 text/csv（UTF-8，≤10 MB，≤10,000 行）
        </p>
      </div>

      {activeError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-[#e45d5d]/30 bg-[#fdecec]/90 px-3 py-2 text-[12px] leading-5 text-[#a83838]"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" />
          <span>{activeError}</span>
        </div>
      )}
    </div>
  );
}
