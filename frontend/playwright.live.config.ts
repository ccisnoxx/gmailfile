import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.LIVE_E2E_BASE_URL || 'http://127.0.0.1:4174',
    // 安全基线：严禁开启 trace / screenshot / video，防止真实后端凭据与明文密码落盘。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    {
      name: 'chromium-live',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_CHROME_EXECUTABLE
          ? {
              executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
              chromiumSandbox: true,
            }
          : undefined,
      },
    },
  ],
});
