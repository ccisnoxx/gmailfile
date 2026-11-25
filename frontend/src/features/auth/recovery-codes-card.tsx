import { Button } from '@/components/ui/button';

export function RecoveryCodesCard({
  codes,
  saved,
  onSavedChange,
  onDownload,
  onDone,
}: {
  codes: string[];
  saved: boolean;
  onSavedChange: (checked: boolean) => void;
  onDownload: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-7 text-muted-foreground">
        这些恢复码只展示这一次。请离线保管，每个只能使用一次。重新生成后，旧码全部失效。
      </p>
      <ul
        aria-label="一次性恢复码"
        className="grid gap-2 rounded-lg bg-muted p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code} className="break-all select-all">
            {code}
          </li>
        ))}
      </ul>
      <Button variant="outline" onClick={onDownload}>
        下载恢复码
      </Button>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => onSavedChange(event.target.checked)}
        />
        我已离线保存恢复码
      </label>
      <Button disabled={!saved} onClick={onDone}>
        完成并清除展示
      </Button>
    </div>
  );
}
