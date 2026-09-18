import { PAGES } from './config.js';
import { store } from './store.js';
import { api } from './api.js';
import { resolvedTheme, setTheme } from './theme.js';
import { paintAvatar } from './ui.js';

// 三个应用页共用同一套导航，新增页面时只改这里
const NAV = [
    { key: 'dashboard', label: '打卡', icon: '📅', href: PAGES.dashboard },
    { key: 'friends', label: '好友', icon: '👥', href: PAGES.friends },
    { key: 'profile', label: '我的', icon: '🙂', href: PAGES.profile }
];

const els = {};

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
        paintThemeButton();
    });

    const cached = store.getUser();
    if (cached) setShellUser(cached);
    paintThemeButton();
}

export function setShellUser(user) {
    if (!els.avatar) return;
    paintAvatar(els.avatar, user);
    els.name.textContent = user.nickname || user.email || '用户';
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
