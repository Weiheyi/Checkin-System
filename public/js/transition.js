// 页面跳转过渡
//
// Chromium 走「跨文档 View Transitions」（见 style.css 里的 @view-transition）：
// 顶部栏 / 底部导航是共享元素，页面本体被一道墨幕横向揭出来。这个模块只补两件事：
//   1. 不支持的浏览器 —— 用同款墨幕兜底，拦下站内链接、先盖墨幕再跳；
//   2. 兜底路径下让内容错峰浮现（走原生过渡时不加：新页会在动画中被截帧，
//      任何入场动画都会被拍到中间态，反而更糟）。
//
// 关掉动画（prefers-reduced-motion）时不做任何拦截，保持普通的即时跳转。

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
// 支持跨文档 View Transitions 的浏览器会派发 pagereveal 事件，用它做特性检测
const supportsViewTransition = 'onpagereveal' in window;

if (!supportsViewTransition && !prefersReduced.matches) installFallback();

function installFallback() {
    playEnterWipe();
    staggerReveal();

    // 离开本页：站内链接先盖墨幕，动画结束再跳
    document.addEventListener('click', event => {
        const href = pickInternalLink(event);
        if (!href) return;
        event.preventDefault();
        playExitWipe(href);
    });

    // 从往返缓存返回时，清掉可能残留（正盖着）的墨幕
    window.addEventListener('pageshow', event => {
        if (event.persisted) document.querySelectorAll('.page-wipe').forEach(el => el.remove());
    });
}

// 进入本页：墨幕先盖满，再向一侧退开，露出新页
function playEnterWipe() {
    const wipe = spawnWipe();
    wipe.classList.add('is-reveal');
    wipe.addEventListener('animationend', () => wipe.remove(), { once: true });
    setTimeout(() => wipe.remove(), 700);
}

// 离开本页：墨幕盖满后跳转。盖满的墨幕留着不管，页面随即卸载
function playExitWipe(href) {
    const wipe = spawnWipe();
    wipe.classList.add('is-cover');

    let navigated = false;
    const go = () => {
        if (navigated) return;
        navigated = true;
        location.href = href;
    };
    wipe.addEventListener('animationend', go, { once: true });
    // 后台标签页里动画可能不触发，兜底跳转
    setTimeout(go, 700);
}

function spawnWipe() {
    const wipe = document.createElement('div');
    wipe.className = 'page-wipe';
    wipe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(wipe);
    return wipe;
}

// 内容错峰浮现：外壳不动，剩下的卡片依次上浮
function staggerReveal() {
    const targets = document.querySelectorAll('.container > *:not(#appShell), .auth-container > *');
    let index = 0;

    targets.forEach(node => {
        if (!(node instanceof HTMLElement) || node.hidden) return;
        node.style.setProperty('--enter-i', String(Math.min(index, 8)));
        node.classList.add('enter-rise');
        index += 1;
    });
}

// 只拦「站内、整页、会真正换页」的左键点击；其余交回浏览器默认行为
function pickInternalLink(event) {
    if (event.defaultPrevented || event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

    const target = event.target instanceof Element ? event.target : null;
    const link = target && target.closest('a[href]');
    if (!link) return null;
    if (link.target && link.target !== '_self') return null;
    if (link.hasAttribute('download')) return null;
    if (link.dataset.noTransition !== undefined) return null;

    let url;
    try {
        url = new URL(link.getAttribute('href'), location.href);
    } catch {
        return null;
    }
    if (url.origin !== location.origin) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    // 同一页里的锚点跳转不算换页
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    if (url.href === location.href) return null;

    return url.href;
}
