import { api } from './api.js';
import { $, $$, toast, setLoading, relativeDate, skeletonRows, emptyState, confirmDialog, paintAvatar } from './ui.js';
import { initShell } from './shell.js';

// null 表示还没加载过；加载后缓存，切换回来不再重复请求。
// 排行榜和好友列表共用同一份 overview 数据，只请求一次。
const state = { feed: null, overview: null, messages: null };
const els = {};
const busy = new Set();
let currentTab = 'feed';

function cacheElements() {
    els.panels = {
        feed: $('#panelFeed'),
        rank: $('#panelRank'),
        friends: $('#panelFriends'),
        messages: $('#panelMessages')
    };
    els.lists = { feed: $('#feedList'), rank: $('#rankList'), friends: $('#friendList') };
    els.msgList = $('#msgList');
    els.msgThread = $('#msgThread');
    els.msgBadge = $('#msgBadge');
    els.segmented = $('#segmented');
    els.friendEmail = $('#friendEmail');
    els.addFriendBtn = $('#addFriendBtn');
}

// 本地 YYYY-MM-DD，relativeDate 用（时间戳来自服务端，需按本地时区取日）
function dayOf(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function clockOf(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

    if (tab === 'messages') {
        // 每次进入「私信」都回到会话列表（关掉可能开着的聊天）
        showMessagesList();
        refreshUnreadBadge();
        if (state.messages) {
            renderMessages();
            return;
        }
        els.msgList.replaceChildren(skeletonRows(3));
        try {
            state.messages = await api.messages.overview();
        } catch (err) {
            els.msgList.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
            return;
        }
        renderMessages();
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

// 增删好友后动态/排行榜/私信都会变，统一失效后重新加载当前分段
function invalidate() {
    state.feed = null;
    state.overview = null;
    state.messages = null;
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

        const actions = document.createElement('div');
        actions.className = 'feed-actions';

        // 评论折叠区：点了才展开、才去拉评论
        const box = document.createElement('div');
        box.className = 'comment-box';
        box.hidden = true;

        actions.append(commentButton(item, box), likeButton(item));
        foot.append(badge, actions);

        card.append(head, content, foot, box);
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

/* ---------------- 动态评论 ---------------- */

function paintCommentCount(btn, count) {
    btn.textContent = `💬 ${count || 0}`;
}

function commentButton(item, box) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'comment-btn';
    paintCommentCount(btn, item.comment_count);
    btn.setAttribute('aria-label', '查看评论');
    btn.addEventListener('click', () => toggleComments(item, btn, box));
    return btn;
}

async function toggleComments(item, btn, box) {
    // 再点一下收起；已加载过的直接展开，不重复拉
    if (!box.hidden) {
        box.hidden = true;
        return;
    }
    box.hidden = false;

    if (box.dataset.loaded === '1') return;
    box.dataset.loaded = '1';

    box.replaceChildren(skeletonRows(1));
    try {
        renderComments(item, btn, box, await api.comments.list(item.checkin_id));
    } catch (err) {
        box.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
    }
}

async function reloadComments(item, btn, box) {
    try {
        const items = await api.comments.list(item.checkin_id);
        item.comment_count = items.length;
        paintCommentCount(btn, item.comment_count);
        renderComments(item, btn, box, items);
    } catch (err) {
        toast(err.message, 'error');
    }
}

function commentItem(item, btn, box, comment) {
    const row = document.createElement('div');
    row.className = 'comment-item';

    const avatar = document.createElement('div');
    avatar.className = 'comment-avatar';
    paintAvatar(avatar, comment);

    const main = document.createElement('div');
    main.className = 'comment-main';

    const head = document.createElement('div');
    head.className = 'comment-head';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = comment.nickname;

    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = relativeDate(dayOf(comment.created_at));

    head.append(author, time);

    if (comment.mine) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'comment-del';
        del.textContent = '删除';
        del.addEventListener('click', async () => {
            const ok = await confirmDialog({
                title: '删除评论',
                message: '确定删除这条评论吗？',
                confirmText: '删除',
                danger: true
            });
            if (!ok) return;
            try {
                await api.comments.remove(comment.id);
                await reloadComments(item, btn, box);
            } catch (err) {
                toast(err.message, 'error');
            }
        });
        head.appendChild(del);
    }

    const text = document.createElement('div');
    text.className = 'comment-text';
    text.textContent = comment.content;

    main.append(head, text);
    row.append(avatar, main);
    return row;
}

function renderComments(item, btn, box, items) {
    const list = document.createElement('div');
    list.className = 'comment-list';

    if (!items.length) {
        list.appendChild(emptyState({ icon: '💬', text: '还没有评论，来说两句吧' }));
    } else {
        items.forEach(comment => list.appendChild(commentItem(item, btn, box, comment)));
    }

    const form = document.createElement('form');
    form.className = 'comment-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.maxLength = 1000;
    input.placeholder = '写评论…';
    input.autocomplete = 'off';

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'add-task-btn';
    send.textContent = '发送';

    form.append(input, send);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const text = input.value.trim();
        const key = `c-${item.checkin_id}`;
        if (!text || busy.has(key)) return;

        busy.add(key);
        try {
            await api.comments.create(item.checkin_id, text);
            input.value = '';
            await reloadComments(item, btn, box);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            busy.delete(key);
        }
    });

    box.replaceChildren(list, form);
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

/* ---------------- 私信 ---------------- */

function showMessagesList() {
    els.msgThread.hidden = true;
    els.msgThread.replaceChildren();
    els.msgList.hidden = false;
}

function renderMessages() {
    const rows = state.messages || [];
    const list = els.msgList;

    if (!rows.length) {
        list.replaceChildren(emptyState({ icon: '💬', text: '还没有好友，先在「好友」里添加，就可以私信了' }));
        return;
    }

    const fragment = document.createDocumentFragment();

    rows.forEach(row => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'msg-item';

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        paintAvatar(avatar, row);

        const main = document.createElement('div');
        main.className = 'msg-main';

        const name = document.createElement('div');
        name.className = 'msg-name';
        name.textContent = row.nickname;

        const preview = document.createElement('div');
        preview.className = 'msg-preview';
        preview.textContent = row.last_content
            ? `${row.last_from_me ? '我：' : ''}${row.last_content}`
            : '还没有聊天记录，点这里开始私信';

        main.append(name, preview);

        const tail = document.createElement('div');
        tail.className = 'msg-tail';

        if (row.last_at) {
            const time = document.createElement('span');
            time.className = 'msg-time';
            time.textContent = relativeDate(dayOf(row.last_at));
            tail.appendChild(time);
        }

        if (row.unread > 0) {
            const dot = document.createElement('span');
            dot.className = 'msg-unread';
            dot.textContent = row.unread > 99 ? '99+' : String(row.unread);
            tail.appendChild(dot);
        }

        item.append(avatar, main, tail);
        item.addEventListener('click', () => openThread(row));
        fragment.appendChild(item);
    });

    list.replaceChildren(fragment);
}

function messageBubble(message) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-bubble' + (message.mine ? ' mine' : '');

    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = message.content;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = clockOf(message.created_at);

    wrap.append(text, meta);
    return wrap;
}

function renderThread(row, items) {
    const head = document.createElement('div');
    head.className = 'msg-thread-head';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-ghost';
    back.textContent = '← 返回';
    back.addEventListener('click', () => {
        showMessagesList();
        renderMessages();
    });

    const name = document.createElement('span');
    name.className = 'msg-thread-name';
    name.textContent = row.nickname;

    head.append(back, name);

    const body = document.createElement('div');
    body.className = 'msg-thread-body';

    if (!items.length) {
        body.appendChild(emptyState({ icon: '💬', text: `和 ${row.nickname} 还没有消息，打个招呼吧` }));
    } else {
        items.forEach(message => body.appendChild(messageBubble(message)));
    }

    const form = document.createElement('form');
    form.className = 'msg-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.maxLength = 2000;
    input.placeholder = '发消息…';
    input.autocomplete = 'off';

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'add-task-btn';
    send.textContent = '发送';

    form.append(input, send);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || busy.has('msg-send')) return;

        busy.add('msg-send');
        try {
            await api.messages.send(row.friend_id, text);
            input.value = '';
            body.appendChild(messageBubble({
                content: text,
                mine: true,
                created_at: new Date().toISOString()
            }));
            // 同步会话列表里的预览
            row.last_content = text;
            row.last_from_me = true;
            row.last_at = new Date().toISOString();
            body.scrollTop = body.scrollHeight;
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            busy.delete('msg-send');
        }
    });

    els.msgThread.replaceChildren(head, body, form);
    input.focus();
    body.scrollTop = body.scrollHeight;
}

async function openThread(row) {
    els.msgList.hidden = true;
    els.msgThread.hidden = false;
    els.msgThread.replaceChildren(skeletonRows(3));

    let items;
    try {
        items = await api.messages.thread(row.friend_id);
    } catch (err) {
        els.msgThread.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
        return;
    }

    renderThread(row, items);

    // 打开会话即标记已读，并把这条会话的未读清掉、刷新角标
    if (row.unread > 0) {
        row.unread = 0;
        try {
            await api.messages.markRead(row.friend_id);
        } catch {
            /* 标记已读失败不影响看消息 */
        }
        refreshUnreadBadge();
    }
}

async function refreshUnreadBadge() {
    try {
        const count = await api.messages.unreadCount();
        els.msgBadge.hidden = !count;
        els.msgBadge.textContent = count > 99 ? '99+' : String(count);
    } catch {
        /* 拿不到就保持现状 */
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
    refreshUnreadBadge();
}

if (initShell({ active: 'friends' })) init();
