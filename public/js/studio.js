// 策索工作室页：密钥门 + 深浅色切换。
// 注意：密钥在前端校验，只是「门口挂个帘子」——静态页面挡不住真正想翻的人，
// 和打卡站的「四则运算」验证同一性质，别当安全边界用。

const KEY = 'cerso';
const UNLOCK_FLAG = 'studio_unlocked';   // 同一个浏览器会话里不再重复要密钥
const THEME_KEY = 'checkin_theme';       // 与打卡站共用，深浅色保持一致

const root = document.documentElement;
const gate = document.getElementById('gate');
const page = document.getElementById('page');
const form = document.getElementById('gateForm');
const input = document.getElementById('gateKey');
const errorEl = document.getElementById('gateError');
const toggleBtn = document.getElementById('gateToggle');
const themeBtn = document.getElementById('themeBtn');

/* ---------------- 密钥门 ---------------- */

function remembered() {
    try {
        return sessionStorage.getItem(UNLOCK_FLAG) === '1';
    } catch {
        return false;
    }
}

function remember() {
    try {
        sessionStorage.setItem(UNLOCK_FLAG, '1');
    } catch {
        /* 存不了就每次都要输，不影响使用 */
    }
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function unlock({ moveFocus = true, animate = true } = {}) {
    remember();
    page.removeAttribute('inert');
    page.removeAttribute('aria-hidden');
    root.classList.add('is-unlocked');

    // 把焦点送进正文，键盘用户不用再从头 Tab 一遍
    if (moveFocus) {
        const heading = page.querySelector('h1');
        if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
    }

    // 门淡出后再从布局里摘掉，这一下就是「进门」的过渡
    const removeGate = () => {
        gate.hidden = true;
        gate.classList.remove('is-leaving');
    };

    if (!animate || reduceMotion.matches) {
        removeGate();
    } else {
        gate.classList.add('is-leaving');
        setTimeout(removeGate, 360);
    }
}

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');

    // 重放抖动动画（先移除、强制重排、再加回）
    gate.classList.remove('shake');
    void gate.offsetWidth;
    gate.classList.add('shake');

    input.select();
}

function clearError() {
    if (errorEl.hidden) return;
    errorEl.hidden = true;
    input.removeAttribute('aria-invalid');
}

form.addEventListener('submit', event => {
    event.preventDefault();
    if (input.value.trim().toLowerCase() === KEY) {
        unlock();
        return;
    }
    showError('密钥不对，再试一次。');
});

input.addEventListener('input', clearError);

toggleBtn.addEventListener('click', () => {
    const hiddenNow = input.type === 'password';
    input.type = hiddenNow ? 'text' : 'password';
    toggleBtn.textContent = hiddenNow ? '隐藏' : '显示';
    toggleBtn.setAttribute('aria-pressed', String(hiddenNow));
    input.focus();
});

if (remembered()) {
    unlock({ moveFocus: false, animate: false });
} else {
    requestAnimationFrame(() => input.focus());
}

/* ---------------- 深浅色 ---------------- */

function paintThemeButton() {
    if (!themeBtn) return;
    const dark = root.dataset.theme === 'dark';
    themeBtn.textContent = dark ? '☀' : '☾';
    themeBtn.setAttribute('aria-label', dark ? '切换到浅色' : '切换到深色');
}

themeBtn.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch {
        /* 忽略 */
    }
    paintThemeButton();
});

paintThemeButton();
