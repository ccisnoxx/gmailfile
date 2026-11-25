import { createContext, useContext } from 'react';
import type { SessionResponse } from '@/api/generated';
import type { AuthNotice } from './use-auth-machine';
import type { SecurityPanel } from './security-settings-panel';
import type { Credentials, ChangePasswordInput } from '@/api/generated';

export type WorkspaceView = 'accounts' | 'security' | 'operations';

type CredentialValues = Credentials &
  Partial<Pick<ChangePasswordInput, 'new_password'>>;

export type WorkspaceContextValue = {
  session: SessionResponse;
  epoch: number;
  busy: boolean;
  notice: AuthNotice;
  panel: SecurityPanel;
  onSession: (value: SessionResponse) => void;
  onNavigate: (view: WorkspaceView) => void;
  onLogout: (clearSessionImmediately?: boolean) => void;
  onAccountFailure: (error: unknown) => void;
  onOperationsFailure: (error: unknown) => void;
  onRefreshSession: () => void;
  onSignedOut: (revocation: Promise<unknown>) => void;
  onSelectPanel: (panel: SecurityPanel) => void;
  onSecuritySubmit: (values: CredentialValues) => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);

export function useWorkspaceContext() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceContext is unavailable');
  return value;
}

export function WorkspaceFallback({
  label = '正在加载工作区…',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center bg-background p-10 text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}
