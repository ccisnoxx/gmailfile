import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { localDate } from '@/lib/format';
import {
  failureText,
  OperationsPager,
  type OperationsPanelProps,
} from './shared';
import { sessionLabels, useSessionsManager } from './use-sessions-manager';

export function SessionsPanel(props: OperationsPanelProps) {
  const state = useSessionsManager({
    session: props.session,
    onFailure: props.onFailure,
    onSignedOut: props.onSignedOut,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Session 管理</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={state.activeOnly ? 'default' : 'outline'}
            aria-pressed={state.activeOnly}
            onClick={() => state.setActiveOnly(!state.activeOnly)}
          >
            {state.activeOnly ? '显示全部会话' : '仅看有效会话'}
          </Button>
          <Button variant="outline" onClick={() => void state.query.refetch()}>
            刷新
          </Button>
          <Button
            variant="destructive"
            onClick={() => state.setTarget('others')}
          >
            撤销其他 Session
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        状态由服务端判断。撤销需最近重新验证，撤销其他会话不会延长当前会话期限。
      </p>
      {state.query.error ? (
        <p role="alert">{failureText(state.query.error)}</p>
      ) : !state.query.data ? (
        <p>正在读取…</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>会话</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近活动</TableHead>
                <TableHead>闲置 / 绝对截止</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.query.data.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">
                      {s.current ? '当前 Session' : '其他 Session'}
                      {s.device_label && s.device_label !== '未知设备'
                        ? ` · ${s.device_label}`
                        : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.id.slice(0, 8)} · {s.ip_address || '未知来源'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.auth_level === 'authenticated' ? '完整认证' : '待 MFA'}
                      {s.mfa_reauthenticated ? ' · Step-Up 有效' : ''}
                    </p>
                  </TableCell>
                  <TableCell>{sessionLabels[s.state]}</TableCell>
                  <TableCell>{localDate(s.last_seen_at)}</TableCell>
                  <TableCell>
                    {localDate(s.idle_expires_at)}
                    <br />
                    {localDate(s.expires_at)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      disabled={s.state === 'revoked'}
                      onClick={() => state.setTarget(s.id)}
                    >
                      {s.current ? '退出当前会话' : '撤销'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <OperationsPager
            page={state.page}
            total={state.query.data.total}
            size={10}
            change={state.setPage}
          />
        </>
      )}
      {state.message && <p role="alert">{state.message}</p>}
      <AlertDialog
        open={state.target !== null}
        onOpenChange={(open) => {
          if (!open && !state.busy) state.setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认撤销 Session？</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后立即失效。当前 Session 被撤销时会退出并清除工作区。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={state.busy}
              onClick={(e) => {
                e.preventDefault();
                void state.confirmRevoke();
              }}
            >
              确认撤销
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
