// 站点离线缓存（Service Worker）
//
// 目标：访问过一次之后，断网也能打开页面、用背单词/字典/词汇量测试这些本地功能。
//
// 策略：
//   - 跨域请求（Supabase）一律不拦，直接走网络 —— 缓存接口数据会让页面显示陈旧的打卡与好友数据
//   - 页面导航：网络优先，断网才回缓存 —— 联网时总能拿到最新 HTML
//   - 同源静态资源：缓存优先 —— 项目的 css / js 都带 ?v=提交号，地址变了就是新文件，可以放心用缓存
//
// 更新：注册地址带部署版本号（见 js/offline.js），每次部署都是一个新地址，
// 浏览器一定会重新安装，不会卡在旧版本。activate 时把带旧 ?v= 的条目清掉；
// 词典、音标这些没有 ?v= 的大文件留着，免得每次发版都重下 6MB。

const CACHE = 'checkin-site';

// 需要预缓存的页面：装过一次之后，断网也能直接打开它们。
// 新增页面时记得加到这里。
const PAGES = [
    'index.html',
    'dashboard.html',
    'tools.html',
    'record.html',
    'friends.html',
    'profile.html',
    'guide.html'
];

// 从 HTML 里把本地 css / js 抠出来，省得手写一份随时会过期的清单
const LOCAL_REF = /(?:href|src)="((?:css|js|vendor)\/[^"]+)"/g;

// js 模块之间还会互相 import，光扫 HTML 拿不全，这里顺着静态 import 递归走一遍。
// 只跟静态 import —— pdf.js / tesseract / mammoth 是 import() 动态加载的大文件，
// 装的时候不下，等真正用到时再按需缓存。
const JS_IMPORT = /(?:from|import)\s+'([^']+)'/g;

const version = new URL(self.location.href).searchParams.get('v') || 'dev';

function cacheKeyFor(page) {
    return new URL(page, self.location.href).href;
}

// 顺着依赖把资源缓存下来；js 目录里的模块继续往里跟一层
async function cacheAssets(cache, seeds) {
    const jsPrefix = cacheKeyFor('js/');
    const pending = [...seeds];
    const seen = new Set();

    while (pending.length) {
        const url = pending.shift();
        if (seen.has(url)) continue;
        seen.add(url);

        try {
            // cache: 'reload' 绕过 HTTP 缓存，装的时候直接拿最新的
            const response = await fetch(url, { cache: 'reload' });
            if (!response.ok) continue;

            await cache.put(url, response.clone());

            if (!url.startsWith(jsPrefix)) continue;
            for (const [, href] of (await response.text()).matchAll(JS_IMPORT)) {
                if (href.startsWith('.')) pending.push(new URL(href, url).href);
            }
        } catch {
            // 个别资源拿不到就算了，运行时还会再缓存
        }
    }
}

async function precache() {
    const cache = await caches.open(CACHE);
    const assets = new Set(['favicon.svg']);

    for (const page of PAGES) {
        const url = cacheKeyFor(page);
        try {
            const response = await fetch(url, { cache: 'reload' });
            if (!response.ok) continue;

            await cache.put(url, response.clone());

            for (const [, href] of (await response.text()).matchAll(LOCAL_REF)) {
                assets.add(new URL(href, url).href);
            }
        } catch {
            // 单个页面失败不影响其他页面
        }
    }

    await cacheAssets(cache, assets);
}

self.addEventListener('install', event => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);

        // 清掉上一个版本留下的 ?v= 条目；没有 ?v= 的（词典、音标等）保留
        for (const request of await cache.keys()) {
            const stamped = new URL(request.url).searchParams.get('v');
            if (stamped && stamped !== version) await cache.delete(request);
        }

        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // 跨域交给网络；缓存接口数据只会让页面显示陈旧内容
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(navigateFirst(request));
        return;
    }

    event.respondWith(cacheFirst(request));
});

// 页面导航：联网时走网络，断网时用缓存里的同一个页面
async function navigateFirst(request) {
    const cache = await caches.open(CACHE);
    // 按去掉查询串的地址存，record.html?id=xxx 这类只占一份缓存
    const key = new URL(new URL(request.url).pathname, self.location.origin).href;

    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(key, response.clone());
        return response;
    } catch {
        return (await cache.match(key))
            || (await cache.match(cacheKeyFor('index.html')))
            || Response.error();
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);

    const hit = await cache.match(request);
    if (hit) return hit;

    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
    } catch {
        return Response.error();
    }
}
