/* 极简安全审计型 Service Worker：
 * 严格安全红线：
 * 1. 绝不拦截、读取或缓存任何 /api/* 路径或非 GET 请求；
 * 2. 绝不缓存 HTML 导航文档、JSON、CSV、二进制下载（.gmenc）或任何凭据响应；
 * 3. 仅允许白名单缓存公开、静态、无用户状态的 App Shell 资产（/assets/*、/icons/* 等）。
 */

const STATIC_CACHE = 'gm-static-shell-v1';
const STATIC_ASSET_ALLOWLIST =
  /^\/(?:assets\/.+|icons\/.+|favicon\.svg|manifest\.webmanifest|theme-init\.js)$/;

const OFFLINE_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>离线提示 — Gmail 账号管理面板</title></head>' +
  '<body style="font-family:-apple-system,sans-serif;display:flex;min-height:100vh;' +
  'align-items:center;justify-content:center;margin:0;background:#0d1626;color:#f1f5fb;">' +
  '<main style="max-width:420px;padding:24px;border-radius:16px;background:#162238;' +
  'border:1px solid rgba(148,178,214,.26);text-align:center;">' +
  '<h1 style="font-size:18px;margin:0 0 8px;">当前网络不可用</h1>' +
  '<p style="font-size:13px;line-height:1.6;color:#b8c7dc;margin:0;">' +
  '出于凭据安全策略，本系统不会在离线缓存中保存账号数据或接口响应。请恢复网络连接后刷新重试。</p>' +
  '</main></body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll([
          '/favicon.svg',
          '/manifest.webmanifest',
          '/theme-init.js',
          '/icons/icon-192.png',
        ]),
      )
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
});

function isCacheableStaticResponse(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  if (response.headers.get('content-disposition')) return false;
  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();
  if (
    contentType.includes('application/json') ||
    contentType.includes('text/csv') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('text/html')
  ) {
    return false;
  }
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 硬安全红线：所有 /api/* 请求与含 Authorization 的请求彻底直通网络，绝不触碰 Cache Storage。
  if (
    url.pathname.startsWith('/api/') ||
    request.headers.has('authorization')
  ) {
    return;
  }

  // 导航 HTML 永不缓存，仅在断网时返回静态无状态离线提示页。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }),
      ),
    );
    return;
  }

  if (!STATIC_ASSET_ALLOWLIST.test(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((networkResponse) => {
          if (isCacheableStaticResponse(networkResponse)) {
            cache.put(request, networkResponse.clone()).catch(() => undefined);
          }
          return networkResponse;
        });
      }),
    ),
  );
});
