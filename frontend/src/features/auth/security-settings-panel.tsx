import { KeyRound, ShieldCheck } from 'lucide-react';
import type { ChangePasswordInput, Credentials } from '@/api/generated';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { CredentialForm } from './credential-form';

export type SecurityPanel = 'reverify' | 'password' | 'rebind' | 'recovery';

type CredentialValues = Credentials &
  Partial<Pick<ChangePasswordInput, 'new_password'>>;

export function SecuritySettingsPanel({
  panel,
  epoch,
  busy,
  stepUpTotpRequired = false,
  onPasskeyReverify,
  onSelectPanel,
  onOpenAccounts,
  onOpenOperations,
  onSubmit,
}: {
  panel: SecurityPanel;
  epoch: number;
  busy: boolean;
  stepUpTotpRequired?: boolean;
  onPasskeyReverify?: () => Promise<void>;
  onSelectPanel: (panel: SecurityPanel) => void;
  onOpenAccounts: () => void;
  onOpenOperations: () => void;
  onSubmit: (values: CredentialValues) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-7">
      <Empty className="p-0 md:p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>已通过二步验证</EmptyTitle>
          <EmptyDescription>
            认证已完成，可返回账号工作区管理资料。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <Button variant="outline" onClick={onOpenAccounts}>
        返回账号列表
      </Button>
      <Button variant="outline" onClick={onOpenOperations}>
        迁移与运维
      </Button>
      <Separator />
      <nav aria-label="安全操作" className="flex flex-wrap gap-2">
        <Button
          variant={panel === 'reverify' ? 'secondary' : 'ghost'}
          disabled={busy}
          onClick={() => onSelectPanel('reverify')}
        >
          重新验证
        </Button>
        <Button
          variant={panel === 'password' ? 'secondary' : 'ghost'}
          disabled={busy}
          onClick={() => onSelectPanel('password')}
        >
          修改密码
        </Button>
        <Button
          variant={panel === 'rebind' ? 'secondary' : 'ghost'}
          disabled={busy}
          onClick={() => onSelectPanel('rebind')}
        >
          重绑验证器
        </Button>
        <Button
          variant={panel === 'recovery' ? 'secondary' : 'ghost'}
          disabled={busy}
          onClick={() => onSelectPanel('recovery')}
        >
          重新生成恢复码
        </Button>
      </nav>
      <p className="text-sm leading-7 text-muted-foreground">
        {panel === 'reverify'
          ? stepUpTotpRequired
            ? '敏感操作前需输入当前密码和 TOTP 验证码，验证在 5 分钟内有效。'
            : '敏感操作前重新输入密码，验证在 5 分钟内有效。'
          : panel === 'password'
            ? '改密后所有会话立即退出。新密码至少 16 位并建议使用长密码短语，请先完成重新验证。'
            : '请先重新验证，再输入当前密码和现有 TOTP 或恢复码。此操作会撤销其他会话；验证码不能重复使用。'}
      </p>
      {panel === 'reverify' && onPasskeyReverify && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void onPasskeyReverify()}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          使用通行密钥（Passkey）重新验证
        </Button>
      )}
      <CredentialForm
        key={`${panel}-${epoch}`}
        kind={
          panel === 'reverify'
            ? 'reverify'
            : panel === 'password'
              ? 'password'
              : 'factor'
        }
        busy={busy}
        requireStepUpTotp={panel === 'reverify' && stepUpTotpRequired}
        onSubmit={onSubmit}
      />
    </div>
  );
}
