import type { ErrorResponse, SessionResponse } from '@/api/generated';
import { Button } from '@/components/ui/button';

export type OperationsPanelProps = {
  session: SessionResponse;
  onSession?: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onBack: () => void;
  onSecurity: () => void;
  onRefreshSession: () => void;
  onSignedOut: (revocation: Promise<unknown>) => void;
};

export function failureText(error: unknown, modifying = false) {
  const result = error as Partial<ErrorResponse>;
  if (
    result?.error &&
    !['INTERNAL_ERROR', 'DECRYPTION_FAILED'].includes(result.error.code)
  )
    return result.error.message;
  return modifying
    ? '结果未知。请先检查账号、会话或审计记录，不要自动重试。'
    : '无法读取，请检查连接后手动刷新。';
}

export function OperationsPager({
  page,
  total,
  size,
  change,
}: {
  page: number;
  total: number;
  size: number;
  change: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>
        共 {total} 条 · 第 {page} 页
      </span>
      <Button
        variant="outline"
        disabled={page === 1}
        onClick={() => change(page - 1)}
      >
        上一页
      </Button>
      <Button
        variant="outline"
        disabled={page * size >= total}
        onClick={() => change(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}
