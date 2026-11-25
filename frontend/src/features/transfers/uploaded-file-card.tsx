import { FileSpreadsheet, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UploadedFileMeta } from './types';

export function UploadedFileCard({
  file,
  onRemove,
  disabled = false,
  className,
}: {
  file: UploadedFileMeta;
  onRemove: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      data-slot="uploaded-file-card"
      className={cn(
        'flex items-start justify-between gap-2.5 rounded-2xl border border-white/85 bg-white/64 p-3 shadow-[0_4px_14px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#1677ff]/20 bg-[#eaf3ff] text-[var(--accent)]"
        >
          <FileSpreadsheet className="size-4.5" />
        </span>

        <div className="min-w-0">
          <p
            title={file.name}
            className="truncate text-[13px] font-semibold text-[var(--text-primary)]"
          >
            {file.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] tabular-nums text-[var(--text-secondary)]">
            <span>{file.sizeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{file.rowCount.toLocaleString('en-US')} 行</span>
            <span aria-hidden="true">·</span>
            <span className="rounded-md border border-[#b9d0ec]/65 bg-white/75 px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-primary)]">
              {file.encoding}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        aria-label="移除文件"
        title="移除已上传文件"
        onClick={onRemove}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-[var(--text-secondary)] transition-colors hover:border-[#e45d5d]/25 hover:bg-[#fdecec]/85 hover:text-[#b93838] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
