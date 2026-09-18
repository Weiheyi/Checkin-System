import { api } from './api.js';
import { $, $$, toast, setLoading, relativeDate, skeletonRows, emptyState, confirmDialog, paintAvatar } from './ui.js';
import { initShell } from './shell.js';

// null 表示还没加载过；加载后缓存，切换回来不再重复请求。
// 排行榜和好友列表共用同一份 overview 数据，只请求一次。
const state = { feed: null, overview: null };
const els = {};
const busy = new Set();
let currentTab = 'feed';

function cacheElements() {
    els.panels = { feed: $('#panelFeed'), rank: $('#panelRank'), friends: $('#panelFriends') };
    els.lists = { feed: $('#feedList'), rank: $('#rankList'), friends: $('#friendList') };
    els.segmented = $('#segmented');
    els.friendEmail = $('#friendEmail');
    els.addFriendBtn = $('#addFriendBtn');
}

/* ---------------- 分段切换 ---------------- */

function showTab(tab) {
    currentTab = tab;

    $$('#segmented button').forEach(btn => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    Object.entries(els.panels).forEach(([key, panel]) => {
        panel.hidden = key !== tab;
    });

    loadTab(tab);
}

async function loadTab(tab) {
    if (tab === 'feed') {
        if (state.feed) return;
        els.lists.feed.replaceChildren(skeletonRows(3));
        try {
            state.feed = await api.friends.feed(20);
            renderFeed();
        } catch (err) {
            els.lists.feed.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
        }
        return;
    }

    if (!state.overview) {
        els.lists[tab].replaceChildren(skeletonRows(3));
        try {
            state.overview = await api.friends.overview();
        } catch (err) {
            els.lists[tab].replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
            return;
        }
    }

    if (tab === 'rank') renderRank();
    else renderFriends();
}

// 增删好友后动态/排行榜都会变，统一失效后重新加载当前分段
function invalidate() {
    state.feed = null;
    state.overview = null;
}

/* ---------------- 动态 ---------------- */

function likeButton(item) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'like-btn' + (item.liked_by_me ? ' active' : '');
    btn.textContent = `${item.liked_by_me ? '❤️' : '🤍'} ${item.like_count}`;
    btn.setAttribute('aria-label', item.liked_by_me ? '取消点赞' : '点赞');
    btn.addEventListener('click', () => toggleLike(item, btn));
    return btn;
}

function renderFeed() {
    const items = state.feed || [];
    const list = els.lists.feed;

    if (!items.length) {
        list.replaceChildren(emptyState({ icon: '👥', text: '还没有好友动态，先去「好友」里添加好友吧' }));
        return;
    }

    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'feed-item';

        const head = document.createElement('div');
        head.className = 'feed-head';

        const avatar = document.createElement('div');
        avatar.className = 'feed-avatar';
        paintAvatar(avatar, item);

        const meta = document.createElement('div');
        meta.className = 'feed-meta';

        const name = document.createElement('span');
        name.className = 'feed-name';
        name.textContent = item.nickname;

        const date = document.createElement('span');
        date.className = 'feed-date';
        date.textContent = relativeDate(item.checkin_date);

        meta.append(name, date);
        head.append(avatar, meta);

        const content = document.createElement('p');
        content.className = 'feed-content';
        content.textContent = item.content || '完成了今日打卡';

        const foot = document.createElement('div');
        foot.className = 'feed-foot';

        const badge = document.createElement('span');
        badge.className = 'feed-badge';
        badge.textContent = item.task_total
            ? `完成 ${item.task_done}/${item.task_total} 个任务`
            : '无任务';

        foot.append(badge, likeButton(item));

        card.append(head, content, foot);
        fragment.appendChild(card);
    });

    list.replaceChildren(fragment);
}

async function toggleLike(item, btn) {
    if (busy.has(item.checkin_id)) return;
    busy.add(item.checkin_id);

    // 乐观更新：先改界面，失败再回滚
    const liked = !item.liked_by_me;
    item.liked_by_me = liked;
    item.like_count += liked ? 1 : -1;
    btn.classList.toggle('active', liked);
    btn.textContent = `${liked ? '❤️' : '🤍'} ${item.like_count}`;
    btn.classList.add('just-liked');
    setTimeout(() => btn.classList.remove('just-liked'), 320);

    try {
        await api.likes.toggle(item.checkin_id, liked);
    } catch (err) {
        item.liked_by_me = !liked;
        item.like_count += liked ? -1 : 1;
        btn.classList.toggle('active', item.liked_by_me);
        btn.textContent = `${item.liked_by_me ? '❤️' : '🤍'} ${item.like_count}`;
        toast(err.message, 'error');
    } finally {
        busy.delete(item.checkin_id);
    }
}

/* ---------------- 排行榜 ---------------- */

const MEDALS = ['🥇', '🥈', '🥉'];

function sortedRank() {
    return [...(state.overview || [])].sort((a, b) =>
        b.days_30 - a.days_30 || b.streak - a.streak || b.total_days - a.total_days
    );
}

function renderRank() {
    const rows = sortedRank();
    const list = els.lists.rank;

    if (!rows.length) {
        list.replaceChildren(emptyState({ icon: '🏆', text: '还没有可排名的好友，先添加好友吧' }));
        return;
    }

    const fragment = document.createDocumentFragment();

    rows.forEach((row, index) => {
        const li = document.createElement('div');
        li.className = 'lb-item';

        const rank = document.createElement('div');
        rank.className = 'lb-rank' + (index < 3 ? ' top' : '');
        rank.textContent = MEDALS[index] || String(index + 1);

        const avatar = document.createElement('div');
        avatar.className = 'lb-avatar';
        paintAvatar(avatar, row);

        const main = document.createElement('div');
        main.className = 'lb-main';

        const name = document.createElement('div');
        name.className = 'lb-name';
        name.textContent = row.nickname;

        const sub = document.createElement('div');
        sub.className = 'lb-sub';
        sub.textContent = `连续 ${row.streak} 天 · 累计 ${row.total_days} 天`;

        main.append(name, sub);

        const score = document.createElement('div');
        score.className = 'lb-score';
        const strong = document.createElement('strong');
        strong.textContent = row.days_30;
        const label = document.createElement('span');
        label.textContent = '近30天';
        score.append(strong, label);

        li.append(rank, avatar, main, score);
        fragment.appendChild(li);
    });

    list.replaceChildren(fragment);
}

/* ---------------- 好友列表 ---------------- */

function renderFriends() {
    const rows = state.overview || [];
    const list = els.lists.friends;

    if (!rows.length) {
        list.replaceChildren(emptyState({ icon: '➕', text: '还没有好友，在上面输入对方邮箱添加' }));
        return;
    }

    const fragment = document.createDocumentFragment();

    rows.forEach(row => {
        const li = document.createElement('div');
        li.className = 'lb-item';

        const avatar = document.createElement('div');
        avatar.className = 'lb-avatar';
        paintAvatar(avatar, row);

        const main = document.createElement('div');
        main.className = 'lb-main';

        const name = document.createElement('div');
        name.className = 'lb-name';
        name.textContent = row.nickname;

        const sub = document.createElement('div');
        sub.className = 'lb-sub';
        sub.textContent = `近30天 ${row.days_30} 天 · 连续 ${row.streak} 天`;

        main.append(name, sub);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-ghost';
        remove.textContent = '删除';
        remove.addEventListener('click', () => removeFriend(row, remove));

        li.append(avatar, main, remove);
        fragment.appendChild(li);
    });

    list.replaceChildren(fragment);
}

async function addFriend() {
    const email = els.friendEmail.value.trim();
    if (!email) return toast('请输入好友邮箱', 'error');

    if (busy.has('add')) return;
    busy.add('add');
    setLoading(els.addFriendBtn, true);

    try {
        const { friend } = await api.friends.addByEmail(email);
        toast(`已添加 ${friend ? friend.nickname : '好友'}`, 'success');
        els.friendEmail.value = '';
        invalidate();
        await loadTab(currentTab);
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        busy.delete('add');
        setLoading(els.addFriendBtn, false);
    }
}

async function removeFriend(row, button) {
    const ok = await confirmDialog({
        title: '删除好友',
        message: `确定要删除好友「${row.nickname}」吗？删除后将看不到对方的打卡动态。`,
        confirmText: '删除',
        danger: true
    });
    if (!ok) return;

    setLoading(button, true);
    try {
        await api.friends.remove(row.friend_id);
        toast('已删除好友', 'success');
        invalidate();
        await loadTab(currentTab);
    } catch (err) {
        toast(err.message, 'error');
        setLoading(button, false);
    }
}

function init() {
    cacheElements();

    $$('#segmented button').forEach(btn => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    els.addFriendBtn.addEventListener('click', addFriend);
    els.friendEmail.addEventListener('keydown', e => {
        if (e.key === 'Enter') addFriend();
    });

    showTab('feed');
}

if (initShell({ active: 'friends' })) init();
