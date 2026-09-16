import { api } from './api.js';
import { store } from './store.js';
import { PAGES, TURNSTILE_SITE_KEY } from './config.js';
import { $, $$, showFormMessage, setLoading } from './ui.js';

const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const forgotPanel = $('#forgotPanel');
const resetPanel = $('#resetPanel');
const tabsBar = $('#tabsBar');
const loginMessage = $('#loginMessage');
const registerMessage = $('#registerMessage');
const forgotMessage = $('#forgotMessage');
const resetMessage = $('#resetMessage');

/* ---------------- 人机验证（Cloudflare Turnstile） ---------------- */

const captchaTokens = { login: '', register: '', forgot: '' };
const captchaWidgets = { login: null, register: null, forgot: null };

const captchaConfigured = !!TURNSTILE_SITE_KEY;
let captchaLoaded = false;

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
    if (!captchaLoaded || captchaWidgets[name] !== null) return;
    captchaWidgets[name] = window.turnstile.render(selector, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: token => { captchaTokens[name] = token; },
        'expired-callback': () => { captchaTokens[name] = ''; },
        'error-callback': () => { captchaTokens[name] = ''; }
    });
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

function captchaProblem(name) {
    if (!captchaConfigured) return '';
    if (!captchaLoaded) return '人机验证组件还在加载，请稍候重试';
    if (!captchaTokens[name]) return '请先完成人机验证';
    return '';
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
        renderWidget('login', '#loginCaptcha');
        renderWidget('register', '#regCaptcha');
    });
}

/* ---------------- 面板切换 ---------------- */

// name: 'login' | 'register' | 'forgot' | 'reset'
function showPanel(name) {
    const isTab = name === 'login' || name === 'register';

    tabsBar.classList.toggle('hidden', !isTab);
    loginForm.classList.toggle('hidden', name !== 'login');
    registerForm.classList.toggle('hidden', name !== 'register');
    forgotPanel.classList.toggle('hidden', name !== 'forgot');
    resetPanel.classList.toggle('hidden', name !== 'reset');

    if (isTab) {
        $$('.tab').forEach(tab => {
            const active = tab.dataset.tab === name;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });
    }

    if (name === 'forgot') {
        forgotMessage.className = 'form-message';
        renderWidget('forgot', '#forgotCaptcha');
        $('#forgotEmail').focus();
    }
    if (name === 'reset') {
        resetMessage.className = 'form-message';
        $('#newPassword').focus();
    }
}

function enterApp() {
    location.href = PAGES.dashboard;
}

// 用户点击邮件里的重置链接进来时，地址栏会带有 type=recovery
function enterRecoveryMode() {
    history.replaceState(null, '', location.pathname);
    showPanel('reset');
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

    const problem = captchaProblem('login');
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
        resetCaptcha('login');
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

    const problem = captchaProblem('register');
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
        resetCaptcha('register');
    }
});

$('#forgotLink').addEventListener('click', () => {
    $('#forgotEmail').value = $('#loginEmail').value.trim();
    showPanel('forgot');
});

$('#forgotBack').addEventListener('click', () => showPanel('login'));

$('#forgotBtn').addEventListener('click', async () => {
    const email = $('#forgotEmail').value.trim();
    if (!email) {
        return showFormMessage(forgotMessage, '请输入邮箱');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showFormMessage(forgotMessage, '邮箱格式不正确');
    }

    const problem = captchaProblem('forgot');
    if (problem) return showFormMessage(forgotMessage, problem);

    const button = $('#forgotBtn');
    setLoading(button, true);
    try {
        await api.forgotPassword({ email, captchaToken: tokenOf('forgot') });
        // 未注册的邮箱也会返回成功（防止账号枚举），所以文案保持中性
        showFormMessage(forgotMessage, '重置邮件已发出，请查收邮箱（也看看垃圾箱）', 'success');
    } catch (err) {
        showFormMessage(forgotMessage, err.message);
    } finally {
        setLoading(button, false);
        resetCaptcha('forgot');
    }
});

$('#resetBtn').addEventListener('click', async () => {
    const password = $('#newPassword').value;
    const passwordConfirm = $('#newPasswordConfirm').value;

    if (password.length < 6) {
        return showFormMessage(resetMessage, '密码至少 6 位');
    }
    if (password !== passwordConfirm) {
        return showFormMessage(resetMessage, '两次密码输入不一致');
    }

    const button = $('#resetBtn');
    setLoading(button, true);
    try {
        await api.updatePassword(password);
        // 让用户用新密码重新登录一次，流程更清晰
        await api.logout();
        showPanel('login');
        showFormMessage(loginMessage, '密码已修改，请用新密码登录', 'success');
    } catch (err) {
        showFormMessage(resetMessage, err.message);
    } finally {
        setLoading(button, false);
    }
});

$('#forgotEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#forgotBtn').click();
});

$('#newPasswordConfirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#resetBtn').click();
});

/* ---------------- 初始化 ---------------- */

initCaptcha();
api.onPasswordRecovery(enterRecoveryMode);

// 通过重置链接进来时不能跳走，否则用户就没机会改密码了
const inRecovery = /type=recovery/.test(location.hash);

if (!inRecovery && store.isLoggedIn()) {
    api.me()
        .then(() => location.replace(PAGES.dashboard))
        .catch(() => {});
}
