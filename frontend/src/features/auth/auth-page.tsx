import { lazy, Suspense, useCallback, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Outlet, useInRouterContext, useNavigate } from 'react-router-dom';
import type { ChangePasswordInput, Credentials } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { isWebAuthnSupported } from '@/lib/webauthn';
import { AuthShell } from './auth-shell';
import { CredentialForm } from './credential-form';
import { RecoveryCodesCard } from './recovery-codes-card';
import {
  SecuritySettingsPanel,
  type SecurityPanel,
} from './security-settings-panel';
import { TotpSetupCard } from './totp-setup-card';
import { useAuthMachine } from './use-auth-machine';
import { useTotpManager, useTotpState } from './use-totp-manager';
import {
  WorkspaceContext,
  WorkspaceFallback,
  type OperationsTabKey,
  type WorkspaceContextValue,
  type WorkspaceView,
} from './workspace-context';

const AccountsPage = lazy(() =>
  import('@/features/accounts/accounts-page').then((m) => ({
    default: m.AccountsPage,
  })),
);
const OperationsPage = lazy(() =>
  import('@/features/operations/operations-page').then((m) => ({
    default: m.OperationsPage,
  })),
);

const routePaths: Record<WorkspaceView, string> = {
  accounts: '/',
  security: '/security',
  operations: '/operations',
};

type CredentialValues = Credentials &
  Partial<Pick<ChangePasswordInput, 'new_password'>>;

function AuthWorkspace({
  inRouter,
  view,
  onNavigateView,
}: {
  inRouter: boolean;
  view: WorkspaceView;
  onNavigateView: (next: WorkspaceView, tab?: OperationsTabKey) => void;
}) {
  const [panel, setPanel] = useState<SecurityPanel>('reverify');
  const [passkeyLabel, setPasskeyLabel] = useState('本机通行密钥');
  const totpState = useTotpState();
  const webauthnSupported = isWebAuthnSupported();

  const auth = useAuthMachine({
    onClearSecrets: totpState.clear,
    onReauthRequired: () => {
      setPanel('reverify');
      onNavigateView('security');
    },
  });
  const totp = useTotpManager(auth, totpState);

  const selectPanel = useCallback(
    (value: SecurityPanel) => {
      auth.clearSecrets();
      auth.setMessage('');
      setPanel(value);
    },
    [auth],
  );

  const switchView = useCallback(
    (next: WorkspaceView, tab?: OperationsTabKey) => {
      auth.clearSecrets();
      onNavigateView(next, tab);
    },
    [auth, onNavigateView],
  );

  const handleSecuritySubmit = useCallback(
    (body: CredentialValues) => {
      if (panel === 'reverify')
        return auth.reverify(body.password, body.totp_code);
      if (panel === 'password')
        return auth.changePassword(body.password, body.new_password!);
      if (panel === 'rebind') return totp.startRebind(body as Credentials);
      return totp.regenerateRecoveryCodes(body);
    },
    [auth, panel, totp],
  );

  const authenticated = auth.session?.state === 'authenticated';
  const pending = auth.session?.state === 'mfa_pending';

  if (authenticated && auth.session && !totp.setup && !totp.codes) {
    const context: WorkspaceContextValue = {
      session: auth.session,
      epoch: auth.epoch,
      busy: auth.busy,
      notice: auth.notice,
      panel,
      onSession: auth.setSession,
      onNavigate: switchView,
      onLogout: auth.logout,
      onAccountFailure: auth.handleAccountFailure,
      onOperationsFailure: auth.handleOperationsFailure,
      onRefreshSession: auth.handleRefreshSession,
      onSignedOut: auth.handleSignedOut,
      onSelectPanel: selectPanel,
      onSecuritySubmit: handleSecuritySubmit,
    };

    if (inRouter) {
      return (
        <WorkspaceContext.Provider value={context}>
          <Suspense fallback={<WorkspaceFallback />}>
            <Outlet />
          </Suspense>
        </WorkspaceContext.Provider>
      );
    }

    if (view === 'operations') {
      return (
        <Suspense fallback={<WorkspaceFallback label="正在加载迁移与运维…" />}>
          <OperationsPage
            key={auth.epoch}
            session={auth.session}
            onBack={() => switchView('accounts')}
            onSecurity={() => switchView('security')}
            onFailure={auth.handleOperationsFailure}
            onRefreshSession={auth.handleRefreshSession}
            onSignedOut={auth.handleSignedOut}
          />
        </Suspense>
      );
    }

    if (view === 'accounts') {
      return (
        <Suspense fallback={<WorkspaceFallback label="正在加载账号工作区…" />}>
          <AccountsPage
            key={auth.epoch}
            session={auth.session}
            onSession={auth.setSession}
            onFailure={auth.handleAccountFailure}
            onSecurity={() => switchView('security')}
            onOperations={(tab) => switchView('operations', tab)}
            onLogout={() => auth.logout(true)}
          />
        </Suspense>
      );
    }

    return (
      <AuthShell
        title="安全设置"
        showLogout
        busy={auth.busy}
        notice={auth.notice}
        onLogout={() => auth.logout(false)}
      >
        <SecuritySettingsPanel
          panel={panel}
          epoch={auth.epoch}
          busy={auth.busy}
          stepUpTotpRequired={Boolean(auth.session.step_up_totp_required)}
          onPasskeyReverify={
            auth.session.webauthn_enabled && webauthnSupported
              ? auth.reverifyWithPasskey
              : undefined
          }
          onSelectPanel={selectPanel}
          onOpenAccounts={() => switchView('accounts')}
          onOpenOperations={() => switchView('operations')}
          onSubmit={handleSecuritySubmit}
        />
      </AuthShell>
    );
  }

  const title = totp.codes
    ? '保存你的恢复码'
    : totp.setup || pending
      ? '绑定二步验证'
      : '管理员登录';

  return (
    <AuthShell
      title={title}
      showLogout={Boolean(auth.session && auth.session.state !== 'anonymous')}
      busy={auth.busy}
      notice={auth.notice}
      onLogout={() => auth.logout(false)}
    >
      {!auth.session ? (
        <p role="status" className="text-muted-foreground">
          {auth.notice.message ? '刷新页面以重新连接。' : '正在建立安全连接…'}
        </p>
      ) : totp.codes ? (
        <RecoveryCodesCard
          codes={totp.codes}
          saved={totp.saved}
          onSavedChange={totp.setSaved}
          onDownload={totp.downloadRecoveryCodes}
          onDone={() => {
            auth.clearSecrets();
            setPanel('reverify');
          }}
        />
      ) : totp.setup ? (
        <TotpSetupCard
          setup={totp.setup}
          epoch={auth.epoch}
          busy={auth.busy}
          onConfirm={totp.confirmSetup}
          onCancel={auth.clearSecrets}
        />
      ) : pending ? (
        <div className="flex flex-col gap-5">
          <p className="leading-7 text-muted-foreground">
            密码已验证。请绑定二步验证（TOTP 验证器或 WebAuthn
            通行密钥），完成前不能访问账号资料。使用恢复码登录后也必须重新绑定。
          </p>
          <Button
            disabled={auth.busy}
            onClick={() => void totp.startInitialSetup()}
          >
            开始绑定验证器
          </Button>
          {webauthnSupported && (
            <>
              <Separator />
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    或直接绑定通行密钥（Passkey / FIDO2）
                  </span>
                  <Input
                    aria-label="通行密钥设备名称"
                    maxLength={80}
                    disabled={auth.busy}
                    value={passkeyLabel}
                    onChange={(e) => setPasskeyLabel(e.target.value)}
                    placeholder="例如：MacBook Touch ID / YubiKey"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={auth.busy}
                  onClick={() =>
                    void auth.registerPasskey(passkeyLabel, (res) => {
                      if (res.recovery_codes && res.recovery_codes.length > 0) {
                        totpState.setSaved(false);
                        totpState.setCodes(res.recovery_codes);
                      }
                    })
                  }
                >
                  <KeyRound className="size-4" aria-hidden="true" />
                  绑定通行密钥（Passkey）
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {auth.session.can_passwordless_login && webauthnSupported && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={auth.busy}
                onClick={() => void auth.loginWithPasskey()}
              >
                <KeyRound className="size-4" aria-hidden="true" />
                使用通行密钥（Passkey）登录
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1" />
                <span>或使用管理员密码登录</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}
          <CredentialForm
            key={auth.epoch}
            kind="login"
            busy={auth.busy}
            onSubmit={auth.login}
          />
        </div>
      )}
    </AuthShell>
  );
}

function RoutedAuthWorkspace() {
  const navigate = useNavigate();
  const handleNavigate = useCallback(
    (next: WorkspaceView, tab?: OperationsTabKey) => {
      const searchParams = new URLSearchParams(window.location.search);
      if (next === 'operations' && tab) searchParams.set('tab', tab);
      else searchParams.delete('tab');
      const search = searchParams.toString();
      void navigate({
        pathname: routePaths[next],
        search: search ? `?${search}` : '',
      });
    },
    [navigate],
  );
  return (
    <AuthWorkspace inRouter view="accounts" onNavigateView={handleNavigate} />
  );
}

function StandaloneAuthWorkspace({
  initialView,
}: {
  initialView: WorkspaceView;
}) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  return (
    <AuthWorkspace inRouter={false} view={view} onNavigateView={setView} />
  );
}

export function AuthPage({
  initialView = 'accounts',
}: {
  initialView?: WorkspaceView;
}) {
  const inRouter = useInRouterContext();
  if (inRouter) return <RoutedAuthWorkspace />;
  return <StandaloneAuthWorkspace initialView={initialView} />;
}
