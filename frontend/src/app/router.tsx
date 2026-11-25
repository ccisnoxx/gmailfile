import { createBrowserRouter, Link } from 'react-router-dom';
import { AuthPage } from '@/features/auth/auth-page';

export const router = createBrowserRouter([
  { path: '/', element: <AuthPage /> },
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
