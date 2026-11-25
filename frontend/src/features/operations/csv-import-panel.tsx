import type { CsvOptions } from '@/api/generated';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { localDate } from '@/lib/format';
import type { OperationsPanelProps } from './shared';
import {
  csvFieldLabels,
  useCsvImport,
  type CsvFieldKey,
} from './use-csv-import';

export function ImportPanel(props: OperationsPanelProps) {
  const state = useCsvImport({
    session: props.session,
    onFailure: props.onFailure,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">CSV 两阶段导入</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          选择 UTF-8 CSV（支持 BOM，最大 10 MiB、10000
          条记录），映射字段并预览后再确认。密码、手机号和备注不展示；离开或隐藏页面会清除文件。
        </p>
      </div>
      <div className="grid items-end gap-4 sm:grid-cols-[1fr_14rem_auto]">
        <div className="space-y-2">
          <label htmlFor="csv-file">CSV 文件</label>
          <Input
            ref={state.inputRef}
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            disabled={state.busy}
            onChange={(e) => state.selectFile(e.target.files?.[0])}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="csv-strategy">重复策略</label>
          <NativeSelect
            id="csv-strategy"
            disabled={state.busy}
            value={state.strategy}
            onChange={(e) =>
              state.changeStrategy(e.target.value as CsvOptions['strategy'])
            }
          >
            <option value="skip">跳过已有（默认）</option>
            <option value="update">更新已有</option>
            <option value="error">重复则拒绝整批</option>
          </NativeSelect>
        </div>
        <Button
          disabled={!state.file || state.busy}
          onClick={() => void state.analyze()}
        >
          上传并预览
        </Button>
      </div>
      <details className="text-sm leading-6">
        <summary className="cursor-pointer font-medium">字段与空值规则</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            update
            仅改映射字段；未映射字段保留。密码为空保留旧值，新账号必须提供密码。
          </li>
          <li>
            可选字段映射为空会清空；tags 用 |
            分隔并替换整组。新账号空注册时间/状态使用默认值。
          </li>
          <li>
            account_no 留空自动生成；已有账号只能填写匹配的 GM
            编号。软删除只允许跳过，不由导入恢复。
          </li>
          <li>
            recovery_email 始终是外部文本；recovery_account 按现有 GM
            编号或规范化邮箱关联，不能同时填写，不关联本批新建记录。
          </li>
          <li>
            文件内规范化重复：skip/update 使用第一行、其余跳过；error
            拒绝整批。预览后记录变化必须重新预览。
          </li>
        </ul>
      </details>
      {state.preview && (
        <div className="space-y-4">
          <h3 className="font-medium">字段映射</h3>
          <p className="text-sm text-muted-foreground">
            只显示标准字段名或列序号，不回显文件标题与原始数据。修改映射后必须重新预览。
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.entries(csvFieldLabels) as [CsvFieldKey, string][]).map(
              ([field, label]) => (
                <label key={field} className="space-y-1 text-sm">
                  <span>{label}</span>
                  <NativeSelect
                    aria-label={`映射${label}`}
                    value={state.mapping?.[field] ?? ''}
                    disabled={state.busy}
                    onChange={(e) => state.updateMapping(field, e.target.value)}
                  >
                    <option value="">不导入此字段</option>
                    {state.preview!.columns.map((c) => (
                      <option key={c.index} value={c.index}>
                        第 {c.index + 1} 列
                        {c.suggested_field
                          ? ` · ${csvFieldLabels[c.suggested_field]}`
                          : ''}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ),
            )}
          </div>
          <Button
            variant="outline"
            disabled={state.busy}
            onClick={() => void state.analyze(true)}
          >
            按当前映射重新预览
          </Button>
          <div className="rounded-lg bg-muted/50 p-4">
            <p>
              共 {state.preview.rows.length} 行：新增{' '}
              {state.preview.rows.filter((r) => r.action === 'create').length} ·
              更新{' '}
              {state.preview.rows.filter((r) => r.action === 'update').length} ·
              跳过{' '}
              {state.preview.rows.filter((r) => r.action === 'skip').length} ·
              错误 {state.preview.errors.length}
            </p>
            {state.preview.receipt_id && (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  确认有效至 {localDate(state.preview.expires_at)}
                  。任一校验或并发冲突均回滚整批。
                </p>
                <label className="my-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.confirmed}
                    onChange={(e) => state.setConfirmed(e.target.checked)}
                  />
                  我确认当前文件、映射和重复策略
                </label>
                <Button
                  disabled={!state.confirmed || state.busy}
                  onClick={() => void state.submit()}
                >
                  确认提交整批导入
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {state.busy && <p role="status">正在处理，请勿重复提交…</p>}
      {state.message && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.issues.length > 0 && (
        <div role="alert" className="max-h-64 overflow-auto">
          <h3 className="font-medium">逐行错误（{state.issues.length}）</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {state.issues.map((e, i) => (
              <li key={i}>
                {e.row ? `第 ${e.row} 行` : '文件'} · {e.field}：{e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        variant="ghost"
        disabled={state.busy}
        onClick={state.resetWithNotice}
      >
        清除导入内容
      </Button>
    </div>
  );
}
