import { api } from './api.js';
import { PAGES } from './config.js';
import { createImagePicker } from './image-picker.js';
import { $, toast, setLoading, relativeDate, skeletonRows, emptyState, confirmDialog, paintAvatar } from './ui.js';
import { initShell } from './shell.js';

const els = {};
const postId = new URLSearchParams(location.search).get('id');
let picker = null;

function cacheElements() {
    els.back = $('#backBtn');
    els.detail = $('#postDetail');
    els.count = $('#commentCount');
    els.list = $('#commentList');
    els.content = $('#commentContent');
    els.file = $('#commentImages');
    els.pickBtn = $('#pickCommentImagesBtn');
    els.preview = $('#commentImagePreview');
    els.submit = $('#commentSubmit');
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

function authorHead(item) {
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
    return head;
}

/* ---------------- 帖子正文 ---------------- */

function renderPost(item) {
    if (!item) {
        els.detail.replaceChildren(emptyState({ icon: '🗑️', text: '帖子不存在，或已经被删除了' }));
        return;
    }

    const frag = document.createDocumentFragment();
    frag.append(authorHead(item));

    const title = document.createElement('h3');
    title.className = 'post-title-full';
    title.textContent = item.title;
    frag.append(title);

    if (item.content) {
        const body = document.createElement('p');
        body.className = 'post-body';
        body.textContent = item.content;
        frag.append(body);
    }

    if (item.images && item.images.length) {
        const images = document.createElement('div');
        images.className = 'post-images';
        item.images.forEach(url => {
            const img = document.createElement('img');
            img.className = 'post-image';
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            images.append(img);
        });
        frag.append(images);
    }

    if (item.mine) {
        const actions = document.createElement('div');
        actions.className = 'post-actions';

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'post-del';
        del.textContent = '删除帖子';
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
                toast('已删除', 'success');
                location.href = PAGES.community;
            } catch (err) {
                toast(err.message, 'error');
            }
        });
        actions.append(del);
        frag.append(actions);
    }

    els.detail.replaceChildren(frag);
}

/* ---------------- 评论 ---------------- */

function commentItem(item) {
    const wrap = document.createElement('div');
    wrap.className = 'comment-item';

    const avatar = document.createElement('div');
    avatar.className = 'comment-avatar';
    paintAvatar(avatar, item);

    const main = document.createElement('div');
    main.className = 'comment-main';

    const head = document.createElement('div');
    head.className = 'comment-head';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = item.nickname;

    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = `${relativeDate(dayOf(item.created_at))} ${clockOf(item.created_at)}`;

    head.append(author, time);

    if (item.mine) {
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
                await api.postComments.remove(item.id);
                await loadComments();
            } catch (err) {
                toast(err.message, 'error');
            }
        });
        head.append(del);
    }

    main.append(head);

    if (item.content) {
        const text = document.createElement('p');
        text.className = 'comment-text';
        text.textContent = item.content;
        main.append(text);
    }

    if (item.images && item.images.length) {
        const images = document.createElement('div');
        images.className = 'comment-images';
        item.images.forEach(url => {
            const img = document.createElement('img');
            img.className = 'post-thumb';
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            images.append(img);
        });
        main.append(images);
    }

    wrap.append(avatar, main);
    return wrap;
}

function renderComments(items) {
    els.count.textContent = items.length ? `（${items.length}）` : '';

    if (!items.length) {
        els.list.replaceChildren(emptyState({ icon: '💬', text: '还没有评论，来说两句吧' }));
        return;
    }

    els.list.replaceChildren(...items.map(commentItem));
}

async function loadComments() {
    els.list.replaceChildren(skeletonRows(2));
    try {
        renderComments(await api.postComments.list(postId));
    } catch (err) {
        els.list.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
    }
}

async function submitComment() {
    const content = els.content.value.trim();
    if (!content && !picker.files.length) {
        toast('评论不能为空', 'error');
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

        await api.postComments.create(postId, { content, images });
        els.content.value = '';
        picker.reset();
        toast('评论成功', 'success');
        await loadComments();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.submit, false);
    }
}

/* ---------------- 初始化 ---------------- */

async function load() {
    els.detail.replaceChildren(skeletonRows(2));
    els.list.replaceChildren(skeletonRows(2));

    try {
        renderPost(await api.posts.get(postId));
    } catch (err) {
        els.detail.replaceChildren(emptyState({ icon: '⚠️', text: err.message }));
    }

    await loadComments();
}

function init() {
    if (!postId) {
        location.replace(PAGES.community);
        return;
    }

    cacheElements();

    picker = createImagePicker({ input: els.file, button: els.pickBtn, preview: els.preview });

    els.back.addEventListener('click', () => {
        if (document.referrer && new URL(document.referrer).origin === location.origin) history.back();
        else location.href = PAGES.community;
    });
    els.submit.addEventListener('click', submitComment);

    load();
}

if (initShell({ active: 'community' })) init();
