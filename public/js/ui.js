export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function formatDateZh(date = new Date()) {
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
}

function toastHost() {
    let host = document.getElementById('toastHost');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toastHost';
        host.className = 'toast-host';
        document.body.appendChild(host);
    }
    return host;
}

export function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    toastHost().appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
    }, 2600);
}

export function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
}

export function showFormMessage(container, text, type = 'error') {
    if (!container) return;
    container.textContent = text;
    container.className = `form-message ${type} show`;
    clearTimeout(container._timer);
    container._timer = setTimeout(() => container.classList.remove('show'), 3000);
}

/* ---------------- 展示辅助 ---------------- */

// 头像规则：优先用用户选的 emoji，没有则退回昵称首字
export function avatarLabel(user) {
    if (!user) return '学';
    return user.avatar_emoji || (user.nickname || user.email || '学').charAt(0);
}

export function paintAvatar(el, user) {
    if (!el) return;
    el.textContent = avatarLabel(user);
    el.classList.toggle('has-emoji', !!(user && user.avatar_emoji));
}

function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// YYYY-MM-DD → 今天 / 昨天 / 原样日期
export function relativeDate(dateStr) {
    if (!dateStr) return '';
    const today = new Date();
    if (dateStr === dateKey(today)) return '今天';

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === dateKey(yesterday)) return '昨天';

    return dateStr;
}

// 首屏占位骨架，减少「空白等待」的观感
export function skeletonRows(count = 3) {
    const wrap = document.createElement('div');
    wrap.className = 'skeleton-list';
    for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'skeleton skeleton-row';
        wrap.appendChild(row);
    }
    return wrap;
}

export function emptyState({ icon = '📭', text = '暂无内容' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const iconEl = document.createElement('div');
    iconEl.className = 'empty-state-icon';
    iconEl.textContent = icon;

    const textEl = document.createElement('p');
    textEl.className = 'empty-state-text';
    textEl.textContent = text;

    wrap.append(iconEl, textEl);
    return wrap;
}

// 替代原生 confirm：风格统一、支持异步等待
export function confirmDialog({
    title = '确认操作',
    message = '',
    confirmText = '确定',
    cancelText = '取消',
    danger = false
} = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        const heading = document.createElement('h4');
        heading.className = 'modal-title';
        heading.textContent = title;

        const text = document.createElement('p');
        text.className = 'modal-text';
        text.textContent = message;

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-ghost';
        cancel.textContent = cancelText;

        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = danger ? 'btn-danger' : 'btn-primary';
        ok.textContent = confirmText;

        actions.append(cancel, ok);
        box.append(heading);
        if (message) box.append(text);
        box.append(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close(result) {
            overlay.classList.remove('show');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 180);
            resolve(result);
        }

        function onKey(e) {
            if (e.key === 'Escape') close(false);
        }

        cancel.addEventListener('click', () => close(false));
        ok.addEventListener('click', () => close(true));
        overlay.addEventListener('click', e => {
            if (e.target === overlay) close(false);
        });
        document.addEventListener('keydown', onKey);

        requestAnimationFrame(() => overlay.classList.add('show'));
        ok.focus();
    });
}
