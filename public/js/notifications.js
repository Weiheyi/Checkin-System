// 全局提醒：顶栏 🔔 铃铛 + 通知面板 + 导航角标。
//
// 覆盖四类：好友私信 / 论坛新帖 / 我帖子下的新评论 / 我动态下的新评论。
// 全站没有 realtime，沿用轮询（60s）+ 回到前台时刷新；离线时不请求，避免报错。
//
// 已读口径：私信看 messages.read_at（打开会话时标记）；论坛与动态看服务端
// notification_seen 的时间点（打开通知面板即视为看过论坛 / 动态两类）。
import { api } from './api.js';
import { PAGES } from './config.js';
import { relativeDate, paintAvatar } from './ui.js';
import * as net from './net.js';

const POLL_MS = 60000;
const LIST_LIMIT = 30;

// 导航项角标统计哪些通知类型（铃铛角标是全部之和）
const NAV_TYPES = {
    friends: ['message'],
    community: ['post', 'post_comment']
};

const ICONS = {
    message: '✉️',
    post: '📝',
    post_comment: '💬',
    checkin_comment: '💭'
};

const els = {};
let started = false;
let counts = { message: 0, post: 0, post_comment: 0, checkin_comment: 0 };

function badgeText(n) {
    return n > 99 ? '99+' : String(n);
}

function setBadge(el, n) {
    if (!el) return;
    el.hidden = !n;
    el.textContent = n ? badgeText(n) : '';
}

function applyBadges() {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    setBadge(els.bellBadge, total);

    document.querySelectorAll('[data-nav-badge]').forEach(el => {
        const types = NAV_TYPES[el.dataset.navBadge] || [];
        setBadge(el, types.reduce((sum, type) => sum + (counts[type] || 0), 0));
    });
}

// 拉一次未读数并刷新角标。其它页面（如好友页标已读后）也可以调用
export async function refreshNotifications() {
    if (net.isOffline()) return;

    try {
        counts = await api.notifications.summary();
        applyBadges();
    } catch {
        // 拿不到就保持现状，别打扰用户
    }
}

/* ---------------- 面板 ---------------- */

function emptyLine(text) {
    const p = document.createElement('p');
    p.className = 'notif-empty';
    p.textContent = text;
    return p;
}

// 本地 YYYY-MM-DD，relativeDate 用（时间戳来自服务端，需按本地时区取日）
function dayOf(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function hrefOf(item) {
    if (item.kind === 'message') return `${PAGES.friends}?tab=messages`;
    if (item.kind === 'post' || item.kind === 'post_comment') {
        return `${PAGES.post}?id=${encodeURIComponent(item.target_id)}`;
    }
    return PAGES.friends;
}

function textOf(item) {
    const who = item.nickname || '用户';
    if (item.kind === 'message') return `${who} 给你发了一条私信`;
    if (item.kind === 'post') return `${who} 发布了新帖`;
    if (item.kind === 'post_comment') return `${who} 评论了你的帖子`;
    return `${who} 评论了你的动态`;
}

function previewOf(item) {
    const title = (item.title || '').trim();
    const preview = (item.preview || '').trim();
    if (title && preview) return `${title}：${preview}`;
    return title || preview;
}

function notificationItem(item) {
    const link = document.createElement('a');
    link.className = 'notif-item';
    if (item.is_new) link.classList.add('notif-new');
    link.href = hrefOf(item);

    const icon = document.createElement('span');
    icon.className = 'notif-item-icon';
    icon.textContent = ICONS[item.kind] || '🔔';

    const avatar = document.createElement('span');
    avatar.className = 'notif-item-avatar';
    paintAvatar(avatar, item);

    const body = document.createElement('span');
    body.className = 'notif-item-body';

    const line = document.createElement('span');
    line.className = 'notif-item-line';
    line.textContent = textOf(item);
    body.appendChild(line);

    const preview = previewOf(item);
    if (preview) {
        const snippet = document.createElement('span');
        snippet.className = 'notif-item-preview';
        snippet.textContent = preview;
        body.appendChild(snippet);
    }

    const time = document.createElement('span');
    time.className = 'notif-item-time';
    time.textContent = relativeDate(dayOf(item.created_at));

    link.append(icon, avatar, body, time);
    return link;
}

function onKey(e) {
    if (e.key === 'Escape') closePanel();
}

function onOutsideClick(e) {
    if (els.panel.contains(e.target) || els.bell.contains(e.target)) return;
    closePanel();
}

function closePanel() {
    if (!els.panel) return;
    els.panel.hidden = true;
    els.bell.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKey);
}

async function openPanel() {
    els.panel.hidden = false;
    els.bell.setAttribute('aria-expanded', 'true');
    els.panel.replaceChildren(emptyLine('正在加载…'));

    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onKey);

    let items;
    try {
        items = await api.notifications.list(LIST_LIMIT);
    } catch (err) {
        els.panel.replaceChildren(emptyLine(err.message));
        return;
    }

    // 面板可能在请求期间被关掉了，别把内容塞回去
    if (els.panel.hidden) return;

    els.panel.replaceChildren(
        ...(items.length ? items.map(notificationItem) : [emptyLine('暂时没有新提醒')])
    );

    // 打开面板即视为看过论坛 / 动态两类；私信仍要靠打开会话标已读
    try {
        await api.notifications.markSeen('forum');
        await api.notifications.markSeen('checkin');
    } catch {
        /* 标记失败不影响查看 */
    }

    refreshNotifications();
}

function togglePanel() {
    if (els.panel.hidden) openPanel();
    else closePanel();
}

/* ---------------- 初始化 ---------------- */

export function initNotifications() {
    els.bell = document.getElementById('shellBell');
    els.bellBadge = document.getElementById('bellBadge');
    els.panel = document.getElementById('notifPanel');
    if (!els.bell || !els.panel) return;

    els.bell.addEventListener('click', event => {
        event.stopPropagation();
        togglePanel();
    });

    if (started) return;
    started = true;

    refreshNotifications();
    setInterval(refreshNotifications, POLL_MS);

    // 切回标签页时刷新一次，免得挂后台太久角标停在旧数字
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshNotifications();
    });

    // 从离线切回在线时补一次
    net.subscribe(() => {
        if (!net.isOffline()) refreshNotifications();
    });
}
