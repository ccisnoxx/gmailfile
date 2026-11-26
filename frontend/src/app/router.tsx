import { lazy } from 'react';
import { createBrowserRouter, Link, type RouteObject } from 'react-router-dom';
import { AuthPage } from '@/features/auth/auth-page';

const AccountsRoute = lazy(() => import('@/app/routes/accounts-route'));
const AccountDetailRoute = lazy(
  () => import('@/app/routes/account-detail-route'),
);
const RecoveryEmailsRoute = lazy(
  () => import('@/app/routes/recovery-emails-route'),
);
const AppsRoute = lazy(() => import('@/app/routes/apps-route'));
const SecurityRoute = lazy(() => import('@/app/routes/security-route'));
const OperationsRoute = lazy(() => import('@/app/routes/operations-route'));
const SettingsRoute = lazy(() => import('@/app/routes/settings-route'));
const CsvImportRoute = lazy(() => import('@/app/routes/csv-import-route'));

function createPreviewRoutes(): RouteObject[] {
  const AccountsPreviewRoute = lazy(
    () => import('@/app/routes/accounts-preview-route'),
  );
  const AccountDetailPreviewRoute = lazy(
    () => import('@/app/routes/account-detail-preview-route'),
  );
  const SettingsPreviewRoute = lazy(
    () => import('@/app/routes/settings-preview-route'),
  );
  const CsvImportPreviewRoute = lazy(
    () => import('@/app/routes/csv-import-preview-route'),
  );

  return [
    {
      path: '/preview/accounts',
      element: <AccountsPreviewRoute />,
    },
    {
      path: '/preview/accounts/:accountId',
      element: <AccountDetailPreviewRoute />,
    },
    {
      path: '/preview/account-detail',
      element: <AccountDetailPreviewRoute />,
    },
    {
      path: '/preview/settings',
      element: <SettingsPreviewRoute />,
    },
    {
      path: '/preview/settings/security',
      element: <SettingsPreviewRoute initialSection="security" />,
    },
    {
      path: '/preview/settings/:section',
      element: <SettingsPreviewRoute />,
    },
    {
      path: '/preview/transfers/csv',
      element: <CsvImportPreviewRoute />,
    },
    {
      path: '/preview/imports/csv',
      element: <CsvImportPreviewRoute />,
    },
  ];
}

const baseRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AuthPage />,
    children: [
      { index: true, element: <AccountsRoute /> },
      { path: 'accounts', element: <AccountsRoute /> },
      { path: 'accounts/:accountId', element: <AccountDetailRoute /> },
      { path: 'apps', element: <AppsRoute /> },
      { path: 'recovery-emails', element: <RecoveryEmailsRoute /> },
      { path: 'transfers/csv', element: <CsvImportRoute /> },
      { path: 'imports/csv', element: <CsvImportRoute /> },
      { path: 'security', element: <SecurityRoute /> },
      { path: 'operations', element: <OperationsRoute /> },
      { path: 'settings', element: <SettingsRoute /> },
      {
        path: 'settings/security',
        element: <SettingsRoute initialSection="security" />,
      },
      { path: 'settings/:section', element: <SettingsRoute /> },
    ],
  },
  {
    path: '*',
    element: (
      <main className="mx-auto flex max-w-xl flex-col gap-5 p-10">
        <h1 className="text-2xl font-semibold">页面不存在</h1>
        <Link className="text-primary underline" to="/">
          返回首页
        </Link>
      </main>
    ),
  },
];

export function buildRoutes(
  includePreview: boolean = import.meta.env.DEV,
): RouteObject[] {
  return includePreview
    ? [...createPreviewRoutes(), ...baseRoutes]
    : baseRoutes;
}

export const router = createBrowserRouter(
  import.meta.env.DEV ? [...createPreviewRoutes(), ...baseRoutes] : baseRoutes,
);
