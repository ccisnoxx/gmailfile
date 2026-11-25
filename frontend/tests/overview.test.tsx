import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { OverviewPage } from '@/pages/overview';

afterEach(() => vi.unstubAllGlobals());

it('说明阶段边界，不展示登录表单或账号数据', () => {
  render(
    <Providers>
      <OverviewPage />
    </Providers>,
  );
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    '从安全的基础开始',
  );
  expect(screen.getByText(/账号资料功能尚未开放/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('尚未检查');
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
});

it('通过生成的客户端检查真实 API 响应', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <Providers>
      <OverviewPage />
    </Providers>,
  );
  await userEvent.click(screen.getByRole('button', { name: '检查 API 连接' }));
  expect(await screen.findByText('API 已连接')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('连接失败时显示可操作错误，不显示异常详情', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('private diagnostic')),
  );
  render(
    <Providers>
      <OverviewPage />
    </Providers>,
  );
  await userEvent.click(screen.getByRole('button', { name: '检查 API 连接' }));
  expect(
    await screen.findByText('无法连接 API，请检查后端服务'),
  ).toBeInTheDocument();
  expect(screen.queryByText('private diagnostic')).not.toBeInTheDocument();
});
