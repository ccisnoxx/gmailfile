import { lazy } from 'react';
import { createBrowserRouter, Link } from 'react-router-dom';
import { AuthPage } from '@/features/auth/auth-page';

const AccountsRoute = lazy(() => import('@/app/routes/accounts-route'));
const SecurityRoute = lazy(() => import('@/app/routes/security-route'));
const OperationsRoute = lazy(() => import('@/app/routes/operations-route'));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AuthPage />,
    children: [
      { index: true, element: <AccountsRoute /> },
      { path: 'accounts', element: <AccountsRoute /> },
      { path: 'security', element: <SecurityRoute /> },
      { path: 'operations', element: <OperationsRoute /> },
    ],
  },
  {
    path: '*',
    element: (
      <main className="mx-auto flex max-w-xl flex-col gap-5 p-10">
        <h1 className="text-2xl font-semibold">页面不存在</h1>
        <Link className="text-primary underline" to="/">
          返回登录页
        </Link>
      </main>
    ),
  },
]);
