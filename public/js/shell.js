import { PAGES } from './config.js';
import { store } from './store.js';
import { api } from './api.js';
import { resolvedTheme, setTheme } from './theme.js';
import { paintAvatar, showGuideTip, guideTipOff } from './ui.js';

// 应用页共用同一套导航，新增页面时只改这里
const NAV = [
    { key: 'dashboard', label: '打卡', icon: '📅', href: PAGES.dashboard },
    { key: 'tools', label: '工具', icon: '🧰', href: PAGES.tools },
    { key: 'friends', label: '好友', icon: '👥', href: PAGES.friends },
    { key: 'profile', label: '我的', icon: '🙂', href: PAGES.profile },
    { key: 'guide', label: '说明', icon: '💡', href: PAGES.guide }
];

const els = {};

// 同一次浏览器会话里只提示一次「去看使用说明」
const GUIDE_TIP_SEEN_KEY = 'checkin_guide_tip_seen';

export function requireLogin() {
    if (store.isLoggedIn()) return true;
    location.replace(PAGES.login);
    return false;
}

export async function logout() {
    try {
        await api.logout();
    } finally {
        store.clear();
        location.replace(PAGES.login);
    }
}

function navLinks(active) {
    return NAV.map(item =>
        `<a class="app-nav-link${item.key === active ? ' active' : ''}" href="${item.href}">${item.label}</a>`
    ).join('');
}

function tabItems(active) {
    return NAV.map(item => `
        <a class="tabbar-item${item.key === active ? ' active' : ''}" href="${item.href}">
            <span class="tabbar-icon" aria-hidden="true">${item.icon}</span>
            <span class="tabbar-label">${item.label}</span>
        </a>`).join('');
}

function paintThemeButton() {
    if (!els.theme) return;
    const dark = resolvedTheme() === 'dark';
    els.theme.textContent = dark ? '☀️' : '🌙';
    els.theme.title = dark ? '切换到浅色模式' : '切换到深色模式';
    els.theme.setAttribute('aria-label', els.theme.title);
}

// 渲染顶部栏与移动端底部导航；页面里只需一个 <div id="appShell"></div> 挂载点
export function mountShell({ active }) {
    const host = document.getElementById('appShell');
    if (!host) return;

    host.innerHTML = `
        <header class="app-header">
            <a class="brand" href="${PAGES.dashboard}">
                <span class="brand-icon" aria-hidden="true">📚</span>
                <h1>学习打卡系统</h1>
            </a>
            <nav class="app-nav" aria-label="主导航">${navLinks(active)}</nav>
            <div class="user-info">
                <a class="avatar" id="shellAvatar" href="${PAGES.profile}" title="个人中心">学</a>
                <div class="user-meta">
                    <span class="user-name" id="shellName">用户</span>
                    <span class="user-sub" id="shellSub">今天开始你的打卡</span>
                </div>
                <button class="icon-btn" id="shellTheme" type="button" aria-label="切换主题">🌙</button>
                <button class="btn-ghost" id="shellLogout" type="button">退出</button>
            </div>
        </header>`;

    const tabbar = document.createElement('nav');
    tabbar.className = 'tabbar';
    tabbar.setAttribute('aria-label', '底部导航');
    tabbar.innerHTML = tabItems(active);
    document.body.appendChild(tabbar);

    els.avatar = host.querySelector('#shellAvatar');
    els.name = host.querySelector('#shellName');
    els.sub = host.querySelector('#shellSub');
    els.theme = host.querySelector('#shellTheme');

    host.querySelector('#shellLogout').addEventListener('click', logout);
    els.theme.addEventListener('click', () => {
        setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
    });
    // 主题可能在别处被改（比如个人中心的设置），这里跟着同步图标
    window.addEventListener('themechange', paintThemeButton);

    const cached = store.getUser();
    if (cached) setShellUser(cached);
    paintThemeButton();

    maybeShowGuideTip(active);
}

// 每次访问提示一次去看「使用说明」：同一浏览器会话只弹一次，
// 用户在弹窗里勾了「以后不再提醒」就永久不再弹
function maybeShowGuideTip(active) {
    if (active === 'guide' || guideTipOff()) return;

    try {
        if (sessionStorage.getItem(GUIDE_TIP_SEEN_KEY) === '1') return;
        sessionStorage.setItem(GUIDE_TIP_SEEN_KEY, '1');
    } catch {
        /* 存不了就按「没提示过」处理 */
    }

    // 等外壳渲染完再弹，别抢焦点
    setTimeout(() => showGuideTip({ guideHref: PAGES.guide }), 400);
}

export function setShellUser(user) {
    applyBackground(user);
    if (!els.avatar) return;
    paintAvatar(els.avatar, user);
    els.name.textContent = user.nickname || user.email || '用户';
}

// 自定义背景：铺满视口垫在内容下面，透明度由用户设置。
// 电脑与手机可以各传一张，这里按屏幕宽度选用，另一张作兜底
const MOBILE_MQ = window.matchMedia('(max-width: 720px)');
let lastUser = null;

function backgroundUrlOf(user) {
    if (!user) return '';
    const desktop = user.background_url || '';
    const mobile = user.background_mobile_url || '';
    return MOBILE_MQ.matches ? mobile || desktop : desktop || mobile;
}

function applyBackground(user) {
    lastUser = user;

    const url = backgroundUrlOf(user);
    const existing = document.getElementById('appBg');

    if (!url) {
        if (existing) existing.remove();
        return;
    }

    let layer = existing;
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'appBg';
        layer.className = 'app-bg';
        document.body.prepend(layer);
    }

    layer.style.backgroundImage = `url("${url}")`;
    const opacity = user.background_opacity == null ? 100 : user.background_opacity;
    setBackgroundOpacity(opacity);
}

// 窗口尺寸跨过断点（或手机横竖屏切换）时换用对应的那张
MOBILE_MQ.addEventListener('change', () => {
    if (lastUser) applyBackground(lastUser);
});

// 调整背景透明度（个人中心的滑块用它做即时预览）
export function setBackgroundOpacity(value) {
    const layer = document.getElementById('appBg');
    if (!layer) return;
    layer.style.opacity = String(Math.min(100, Math.max(0, value)) / 100);
}

export function setShellSub(text) {
    if (els.sub) els.sub.textContent = text;
}

// 登录守卫 + 渲染外壳，返回 false 表示已跳转登录页，页面应停止初始化
export function initShell({ active }) {
    if (!requireLogin()) return false;
    mountShell({ active });
    return true;
}
