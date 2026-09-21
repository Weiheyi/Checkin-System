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

// 头像规则：优先用上传的图片，其次用户选的 emoji，最后退回昵称首字
export function avatarLabel(user) {
    if (!user) return '学';
    return user.avatar_emoji || (user.nickname || user.email || '学').charAt(0);
}

export function paintAvatar(el, user) {
    if (!el) return;

    const url = user && user.avatar_url;
    el.classList.toggle('has-image', !!url);
    el.classList.toggle('has-emoji', !url && !!(user && user.avatar_emoji));

    if (url) {
        el.textContent = '';
        el.style.backgroundImage = `url("${url}")`;
    } else {
        el.style.backgroundImage = '';
        el.textContent = avatarLabel(user);
    }
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

// 列一组选项让用户挑一个（「把词加到哪本单词本」这类）；取消或按 Esc 返回 null
export function chooseDialog({ title = '请选择', message = '', options = [], cancelText = '取消' } = {}) {
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
        box.appendChild(heading);

        if (message) {
            const text = document.createElement('p');
            text.className = 'modal-text tight';
            text.textContent = message;
            box.appendChild(text);
        }

        const list = document.createElement('div');
        list.className = 'choose-list';

        options.forEach(option => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'choose-item';
            item.textContent = option.label;

            if (option.hint) {
                const hint = document.createElement('span');
                hint.className = 'choose-hint';
                hint.textContent = option.hint;
                item.appendChild(hint);
            }

            item.addEventListener('click', () => close(option.value));
            list.appendChild(item);
        });

        box.appendChild(list);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-ghost';
        cancel.textContent = cancelText;

        actions.appendChild(cancel);
        box.appendChild(actions);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close(result) {
            overlay.classList.remove('show');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 180);
            resolve(result);
        }

        function onKey(event) {
            if (event.key === 'Escape') close(null);
        }

        cancel.addEventListener('click', () => close(null));
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close(null);
        });
        document.addEventListener('keydown', onKey);

        requestAnimationFrame(() => overlay.classList.add('show'));
    });
}

/* ---------------- 词条报错 / 修正 ---------------- */

// 原因按遇到的多寡排：只报错时第一条默认选中，点一下「提交报错」就够了；
// 直接改词条时默认都不选（原因是顺带备注，可以不选）
const REPORT_REASONS = [
    '释义不对（意思对不上）',
    '中英切分错了（单词和释义串行）',
    '释义缺失或不完整',
    '单词本身拼写有误',
    '其他问题'
];

// 词条报错 / 修正：
//   editable —— 把单词与释义做成输入框，用户改完保存，词条立即更新；
//   否则     —— 只读列出当前词条（免得报到别的词上），只能选原因提交。
// 取消 / Esc 返回 null；editable 时返回 { term, meaning, reason, note }，
// 否则返回 { reason, note }
export function reportDialog({ term = '', meaning = '', editable = false } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box report-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        const heading = document.createElement('h4');
        heading.className = 'modal-title';
        heading.textContent = editable ? '✏️ 修正词条' : '⚠️ 报错';

        const text = document.createElement('p');
        text.className = 'modal-text tight';
        text.textContent = editable
            ? '这个单词或释义不对？直接改成正确的，保存后立即生效。'
            : '这个单词或释义有问题？选一个原因提交，我会去核对。';

        box.append(heading, text);

        // 可编辑时用输入框替掉只读引用；两个字段一起给，改单词还是改释义都行
        let termInput = null;
        let meaningInput = null;

        if (editable) {
            termInput = document.createElement('input');
            termInput.type = 'text';
            termInput.maxLength = 200;
            termInput.value = term;
            termInput.setAttribute('aria-label', '单词');

            const termLabel = document.createElement('label');
            termLabel.textContent = '单词';
            const termGroup = document.createElement('div');
            termGroup.className = 'form-group report-field';
            termGroup.append(termLabel, termInput);

            meaningInput = document.createElement('textarea');
            meaningInput.maxLength = 500;
            meaningInput.value = meaning;
            meaningInput.setAttribute('aria-label', '释义');

            const meaningLabel = document.createElement('label');
            meaningLabel.textContent = '释义';
            const meaningGroup = document.createElement('div');
            meaningGroup.className = 'form-group report-field';
            meaningGroup.append(meaningLabel, meaningInput);

            box.append(termGroup, meaningGroup);
        } else {
            const quote = document.createElement('div');
            quote.className = 'report-quote';

            const quoteTerm = document.createElement('div');
            quoteTerm.className = 'report-quote-term';
            quoteTerm.textContent = term || '（没有单词）';

            const quoteMeaning = document.createElement('div');
            quoteMeaning.className = 'report-quote-meaning';
            quoteMeaning.textContent = meaning || '（没有释义）';

            quote.append(quoteTerm, quoteMeaning);
            box.appendChild(quote);
        }

        // 直接改的时候原因只是备注，可以不选；只报错就必须选一个
        let reason = editable ? '' : REPORT_REASONS[0];

        const reasonHint = document.createElement('p');
        reasonHint.className = 'modal-text tight';
        reasonHint.textContent = editable ? '原因（可不选，方便我核对）' : '选一个原因：';
        box.appendChild(reasonHint);

        const chips = document.createElement('div');
        chips.className = 'report-reasons';

        REPORT_REASONS.forEach(label => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `preset-chip${!editable && label === reason ? ' active' : ''}`;
            chip.textContent = label;
            chip.addEventListener('click', () => {
                // 再点一下取消选中；「报错」必须留一个，所以那时不允许取消
                if (reason === label) {
                    if (!editable) return;
                    reason = '';
                } else {
                    reason = label;
                }
                [...chips.children].forEach(item => item.classList.toggle('active', item.textContent === reason));
            });
            chips.appendChild(chip);
        });

        const note = document.createElement('textarea');
        note.className = 'report-note';
        note.maxLength = 500;
        note.placeholder = editable ? '补充说明（可不填）' : '补充说明（可不填）：正确释义、错在哪里…';
        note.setAttribute('aria-label', '补充说明');

        const message = document.createElement('div');
        message.className = 'form-message';

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-ghost';
        cancel.textContent = '取消';

        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn-primary';
        ok.textContent = editable ? '保存修改' : '提交报错';

        actions.append(cancel, ok);
        box.append(chips, note, message, actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close(result) {
            overlay.classList.remove('show');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 180);
            resolve(result);
        }

        function onKey(event) {
            if (event.key === 'Escape') close(null);
        }

        function submit() {
            if (editable) {
                const nextTerm = termInput.value.trim();
                if (!nextTerm) return showFormMessage(message, '单词不能为空', 'error');
                close({
                    term: nextTerm,
                    meaning: meaningInput.value.trim(),
                    reason,
                    note: note.value.trim()
                });
                return;
            }

            close({ reason, note: note.value.trim() });
        }

        cancel.addEventListener('click', () => close(null));
        ok.addEventListener('click', submit);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close(null);
        });
        document.addEventListener('keydown', onKey);

        requestAnimationFrame(() => overlay.classList.add('show'));

        // 改词条时把光标放到释义末尾（多数情况下坏的就是释义），否则焦点给主按钮
        if (editable) {
            meaningInput.focus();
            meaningInput.setSelectionRange(meaningInput.value.length, meaningInput.value.length);
        } else {
            ok.focus();
        }
    });
}

/* ---------------- 使用说明提醒 ---------------- */

const GUIDE_TIP_KEY = 'checkin_guide_tip_off';

// 用户勾过「以后不再提醒」就一直不再弹；
// 隐私模式下写不了存储，视为已关掉，免得每次访问都打扰
export function guideTipOff() {
    try {
        return localStorage.getItem(GUIDE_TIP_KEY) === '1';
    } catch {
        return true;
    }
}

function rememberGuideTipOff() {
    try {
        localStorage.setItem(GUIDE_TIP_KEY, '1');
    } catch {
        /* 忽略 */
    }
}

// 访问时提示去看「使用说明」；勾了「以后不再提醒」就永久关掉
export function showGuideTip({ guideHref = 'guide.html' } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h4');
    heading.className = 'modal-title';
    heading.textContent = '💡 先看一眼使用说明？';

    const text = document.createElement('p');
    text.className = 'modal-text tight';
    text.textContent = '打卡、背单词、考核、字典……功能不少。第一次用的话，建议花两分钟过一遍「说明」，用起来会顺手很多。';

    const check = document.createElement('label');
    check.className = 'check-inline modal-check';
    const mark = document.createElement('input');
    mark.type = 'checkbox';
    const label = document.createElement('span');
    label.textContent = '以后不再提醒';
    check.append(mark, label);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'btn-ghost';
    later.textContent = '以后再说';

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn-primary';
    go.textContent = '去看说明';

    actions.append(later, go);
    box.append(heading, text, check, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() {
        if (mark.checked) rememberGuideTipOff();
        overlay.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.remove(), 180);
    }

    function onKey(event) {
        if (event.key === 'Escape') close();
    }

    later.addEventListener('click', close);
    go.addEventListener('click', () => {
        close();
        location.href = guideHref;
    });
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => overlay.classList.add('show'));
    go.focus();
}
