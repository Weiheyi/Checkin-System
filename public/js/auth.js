import { api } from './api.js';
import { store } from './store.js';
import { PAGES, TURNSTILE_SITE_KEY } from './config.js';
import { $, $$, showFormMessage, setLoading } from './ui.js';
import { createMathCaptcha } from './math-captcha.js';

const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const loginMessage = $('#loginMessage');
const registerMessage = $('#registerMessage');

/* ---------------- 人机验证 ---------------- */

// 第一层：四则运算。纯前端校验，挡住最明显的脚本提交，也能在 Turnstile 不可用时兜底
const mathCaptchas = {
    login: createMathCaptcha({
        questionEl: $('#loginMathQuestion'),
        inputEl: $('#loginMathAnswer'),
        refreshEl: $('#loginMathRefresh')
    }),
    register: createMathCaptcha({
        questionEl: $('#regMathQuestion'),
        inputEl: $('#regMathAnswer'),
        refreshEl: $('#regMathRefresh')
    })
};

// 第二层：Cloudflare Turnstile，token 由 Supabase 用 Secret Key 在服务端校验
const captchaTokens = { login: '', register: '' };
const captchaWidgets = { login: null, register: null };

const captchaConfigured = !!TURNSTILE_SITE_KEY;
let captchaLoaded = false;
let currentPanel = 'login';

// Turnstile 脚本是 async 加载的，可能晚于本模块执行，所以轮询等待
function whenTurnstileReady(done, timeoutMs = 8000) {
    if (window.turnstile) return done(null);
    const started = Date.now();
    const timer = setInterval(() => {
        if (window.turnstile) {
            clearInterval(timer);
            done(null);
        } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
            done(new Error('timeout'));
        }
    }, 200);
}

function renderWidget(name, selector) {
    if (!captchaConfigured || !captchaLoaded || captchaWidgets[name] !== null) return;
    captchaWidgets[name] = window.turnstile.render(selector, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: token => { captchaTokens[name] = token; },
        'expired-callback': () => { captchaTokens[name] = ''; },
        'error-callback': () => { captchaTokens[name] = ''; }
    });
}

// 只渲染当前可见面板的组件：在隐藏容器里渲染 Turnstile 既容易出错也浪费资源
function renderVisibleWidget() {
    if (currentPanel === 'login') {
        renderWidget('login', '#loginCaptcha');
    } else {
        renderWidget('register', '#regCaptcha');
    }
}

// Turnstile 的 token 是一次性的，每次提交后必须复位，否则第二次提交会失败
function resetCaptcha(name) {
    captchaTokens[name] = '';
    if (captchaWidgets[name] !== null && window.turnstile) {
        window.turnstile.reset(captchaWidgets[name]);
    }
}

function tokenOf(name) {
    return captchaConfigured ? captchaTokens[name] : undefined;
}

// 返回第一处未通过的提示，全部通过则返回空字符串（运算题答错时会自动换题）
function humanProblem(name) {
    if (captchaConfigured) {
        if (!captchaLoaded) return '人机验证组件还在加载，请稍候重试';
        if (!captchaTokens[name]) return '请先完成人机验证';
    }
    return mathCaptchas[name].check();
}

// 提交结束后复位两层验证，为下一次提交做准备
function resetHumanCheck(name) {
    resetCaptcha(name);
    mathCaptchas[name].refresh();
}

function initCaptcha() {
    if (!captchaConfigured) return;
    whenTurnstileReady(err => {
        if (err) {
            const tip = '人机验证组件加载失败，请检查网络或代理设置后刷新页面';
            showFormMessage(loginMessage, tip);
            showFormMessage(registerMessage, tip);
            return;
        }
        captchaLoaded = true;
        renderVisibleWidget();
    });
}

/* ---------------- 面板切换 ---------------- */

// name: 'login' | 'register'
function showPanel(name) {
    currentPanel = name;
    loginForm.classList.toggle('hidden', name !== 'login');
    registerForm.classList.toggle('hidden', name !== 'register');

    $$('.tab').forEach(tab => {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });

    renderVisibleWidget();
}

function enterApp() {
    location.href = PAGES.dashboard;
}

/* ---------------- 事件绑定 ---------------- */

$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => showPanel(tab.dataset.tab));
});

loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;

    if (!email || !password) {
        return showFormMessage(loginMessage, '请填写邮箱和密码');
    }

    const problem = humanProblem('login');
    if (problem) return showFormMessage(loginMessage, problem);

    const button = $('button[type=submit]', loginForm);
    setLoading(button, true);
    try {
        await api.login({ email, password, captchaToken: tokenOf('login') });
        enterApp();
    } catch (err) {
        showFormMessage(loginMessage, err.message);
    } finally {
        setLoading(button, false);
        resetHumanCheck('login');
    }
});

registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#regEmail').value.trim();
    const nickname = $('#regNickname').value.trim();
    const password = $('#regPassword').value;
    const passwordConfirm = $('#regPasswordConfirm').value;

    if (!email) {
        return showFormMessage(registerMessage, '邮箱不能为空');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showFormMessage(registerMessage, '邮箱格式不正确');
    }
    if (password.length < 6) {
        return showFormMessage(registerMessage, '密码至少 6 位');
    }
    if (password !== passwordConfirm) {
        return showFormMessage(registerMessage, '两次密码输入不一致');
    }

    const problem = humanProblem('register');
    if (problem) return showFormMessage(registerMessage, problem);

    const button = $('button[type=submit]', registerForm);
    setLoading(button, true);
    try {
        await api.register({ email, nickname, password, captchaToken: tokenOf('register') });
        enterApp();
    } catch (err) {
        showFormMessage(registerMessage, err.message);
    } finally {
        setLoading(button, false);
        resetHumanCheck('register');
    }
});

/* ---------------- 初始化 ---------------- */

initCaptcha();

if (store.isLoggedIn()) {
    api.me()
        .then(() => location.replace(PAGES.dashboard))
        .catch(() => {});
}
