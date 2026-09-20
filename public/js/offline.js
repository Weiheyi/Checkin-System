// 注册 Service Worker，让站点在断网时也能打开（缓存策略见 public/sw.js）
//
// 注册地址带上部署版本号：js/offline.js 自己会被 stamp 成 ?v=提交号，
// 于是每次部署都是一个全新的 sw.js 地址，浏览器一定会重新安装，不会卡在旧版本。

export function registerOffline() {
    if (!('serviceWorker' in navigator)) return;

    // 本地直接双击打开（file://）没有可用的 origin，注册只会报错
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    // '../sw.js' 是相对路径，解析后原本的 ?v= 会被丢掉，这里手动带上同一个版本号
    const url = new URL('../sw.js', import.meta.url);
    url.searchParams.set('v', new URL(import.meta.url).searchParams.get('v') || 'dev');

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(url.href).catch(() => {
            // 离线是锦上添花，注册失败不影响正常使用
        });
    });
}
