import { api } from './api.js';
import { PAGES } from './config.js';
import { createImagePicker } from './image-picker.js';
import { $, toast, setLoading, relativeDate, skeletonRows, emptyState, confirmDialog, paintAvatar } from './ui.js';
import { initShell } from './shell.js';

const PAGE_SIZE = 20;

const state = { posts: [], offset: 0, done: false, busy: false };
const els = {};
let picker = null;

function cacheElements() {
    els.list = $('#postList');
    els.newBtn = $('#newPostBtn');
    els.composer = $('#postComposer');
    els.title = $('#postTitle');
    els.content = $('#postContent');
    els.file = $('#postImages');
    els.pickBtn = $('#pickImagesBtn');
    els.preview = $('#postImagePreview');
    els.submit = $('#postSubmit');
    els.cancel = $('#postCancel');
    els.loadMore = $('#loadMoreBtn');
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

/* ---------------- 发帖表单 ---------------- */

function resetComposer() {
    els.title.value = '';
    els.content.value = '';
    picker.reset();
}

function toggleComposer() {
    els.composer.hidden = !els.composer.hidden;
    if (!els.composer.hidden) els.title.focus();
}

async function submitPost() {
    const title = els.title.value.trim();
    const content = els.content.value.trim();

    if (!title) {
        toast('标题不能为空', 'error');
        els.title.focus();
        return;
    }
    if (!content && !picker.files.length) {
        toast('正文和图片至少填一样', 'error');
        els.content.focus();
        return;
    }

    setLoading(els.submit, true);
    try {
        const images = [];
        for (const file of picker.files) {
            const { url } = await api.posts.uploadImage(file);
            images.push(url);
        }

        await api.posts.create({ title, content, images });
        resetComposer();
        els.composer.hidden = true;
        toast('发帖成功', 'success');
        await reload();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.submit, false);
    }
}

/* ---------------- 帖子列表 ---------------- */

function postCard(item) {
    const card = document.createElement('article');
    card.className = 'post-card';

    const head = document.createElement('div');
    head.className = 'post-head';

    const avatar = document.createElement('div');
    avatar.className = 'post-avatar';
    paintAvatar(avatar, item);

    const meta = document.createElement('div');
    meta.className = 'post-meta';

    const name = document.createElement('span');
    name.className = 'post-author';
    name.textContent = item.nickname;

    const time = document.createElement('span');
    time.className = 'post-time';
    time.textContent = `${relativeDate(dayOf(item.created_at))} ${clockOf(item.created_at)}`;

    meta.append(name, time);
    head.append(avatar, meta);

    const title = document.createElement('a');
    title.className = 'post-title';
    title.href = `${PAGES.post}?id=${encodeURIComponent(item.id)}`;
    title.textContent = item.title;

    card.append(head, title);

    if (item.content) {
        const body = document.createElement('p');
        body.className = 'post-preview';
        body.textContent = item.content;
        card.append(body);
    }

    if (item.images && item.images.length) {
        const images = document.createElement('div');
        images.className = 'post-images';
        item.images.forEach(url => {
            const img = document.createElement('img');
            img.className = 'post-thumb';
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            images.append(img);
        });
        card.append(images);
    }

    const foot = document.createElement('div');
    foot.className = 'post-actions';

    const comments = document.createElement('a');
    comments.className = 'post-comments';
    comments.href = `${PAGES.post}?id=${encodeURIComponent(item.id)}`;
    comments.textContent = `💬 ${item.comment_count}`;
    foot.append(comments);

    if (item.mine) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'post-del';
        del.textContent = '删除';
        del.addEventListener('click', async () => {
            const ok = await confirmDialog({
                title: '删除帖子',
                message: '确定删除这个帖子吗？帖子下的评论也会一起删掉。',
                confirmText: '删除',
                danger: true
            });
            if (!ok) return;

            try {
                await api.posts.remove(item.id);
                state.posts = state.posts.filter(post => post.id !== item.id);
                renderPosts();
                toast('已删除', 'success');
            } catch (err) {
                toast(err.message, 'error');
            }
        });
        foot.append(del);
    }

    card.append(foot);
    return card;
}

function renderPosts() {
    if (!state.posts.length) {
        els.list.replaceChildren(emptyState({ icon: '💬', text: '还没有帖子，点右上角「发帖」发第一帖吧' }));
        els.loadMore.hidden = true;
        return;
    }

    els.list.replaceChildren(...state.posts.map(postCard));
    els.loadMore.hidden = state.done;
}

async function loadPage() {
    const items = await api.posts.list({ limit: PAGE_SIZE, offset: state.offset });
    if (state.offset === 0) state.posts = [];
    state.posts.push(...items);
    state.offset += items.length;
    state.done = items.length < PAGE_SIZE;
    renderPosts();
}

async function reload() {
    state.posts = [];
    state.offset = 0;
    state.done = false;
    els.loadMore.hidden = true;
    els.list.replaceChildren(skeletonRows(3));

    try {
        await loadPage();
    } catch (err) {
        els.list.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
    }
}

async function loadMore() {
    if (state.busy || state.done) return;
    state.busy = true;
    setLoading(els.loadMore, true);
    try {
        await loadPage();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        state.busy = false;
        setLoading(els.loadMore, false);
    }
}

/* ---------------- 初始化 ---------------- */

function init() {
    cacheElements();

    picker = createImagePicker({ input: els.file, button: els.pickBtn, preview: els.preview });

    els.newBtn.addEventListener('click', toggleComposer);
    els.cancel.addEventListener('click', () => {
        resetComposer();
        els.composer.hidden = true;
    });
    els.submit.addEventListener('click', submitPost);
    els.loadMore.addEventListener('click', loadMore);

    reload();
}

if (initShell({ active: 'community' })) init();
