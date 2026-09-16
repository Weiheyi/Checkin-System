import { api } from './api.js';
import { store } from './store.js';
import { PAGES, TURNSTILE_SITE_KEY } from './config.js';
import { $, $$, showFormMessage, setLoading } from './ui.js';

const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const tabsBar = $('#tabsBar');
const verifyPanel = $('#verifyPanel');
const loginMessage = $('#loginMessage');
const registerMessage = $('#registerMessage');
const verifyMessage = $('#verifyMessage');

/* ---------------- 人机验证（Cloudflare Turnstile） ---------------- */

const captchaTokens = { login: '', register: '', verify: '' };
const captchaWidgets = { login: null, register: null, verify: null };

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

function switchTab(mode) {
    const isLogin = mode === 'login';
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    $$('.tab').forEach(tab => {
        const active = tab.dataset.tab === mode;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
}

let pendingEmail = '';
let resendTimer = null;

function showVerifyPanel(email) {
    pendingEmail = email;
    $('#verifyEmail').textContent = email;
    $('#verifyCode').value = '';
    verifyMessage.className = 'form-message';

    tabsBar.classList.add('hidden');
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    verifyPanel.classList.remove('hidden');

    // 面板显示后再渲染，避免在隐藏容器里渲染异常
    renderWidget('verify', '#verifyCaptcha');
    $('#verifyCode').focus();
    startResendCountdown();
}

function hideVerifyPanel() {
    clearInterval(resendTimer);
    verifyPanel.classList.add('hidden');
    tabsBar.classList.remove('hidden');
    switchTab('login');
}

function startResendCountdown(seconds = 60) {
    const button = $('#resendBtn');
    let left = seconds;
    clearInterval(resendTimer);
    button.disabled = true;
    button.textContent = `重新发送（${left}s）`;

    resendTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
            clearInterval(resendTimer);
            button.disabled = false;
            button.textContent = '重新发送验证码';
            return;
        }
        button.textContent = `重新发送（${left}s）`;
    }, 1000);
}

function enterApp() {
    location.href = PAGES.dashboard;
}

/* ---------------- 事件绑定 ---------------- */

$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
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
        const result = await api.register({
            email,
            nickname,
            password,
            captchaToken: tokenOf('register')
        });

        // 需要邮箱验证码，切到验证面板
        if (result && result.pending) {
            showVerifyPanel(result.email);
            return;
        }
        enterApp();
    } catch (err) {
        showFormMessage(registerMessage, err.message);
    } finally {
        setLoading(button, false);
        resetCaptcha('register');
    }
});

$('#verifyBtn').addEventListener('click', async () => {
    const code = $('#verifyCode').value.trim();
    if (!/^\d{6}$/.test(code)) {
        return showFormMessage(verifyMessage, '请输入 6 位数字验证码');
    }

    const button = $('#verifyBtn');
    setLoading(button, true);
    try {
        await api.verifyEmailCode({ email: pendingEmail, token: code });
        enterApp();
    } catch (err) {
        showFormMessage(verifyMessage, err.message);
    } finally {
        setLoading(button, false);
    }
});

$('#verifyCode').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#verifyBtn').click();
});

$('#resendBtn').addEventListener('click', async () => {
    const problem = captchaProblem('verify');
    if (problem) {
        return showFormMessage(verifyMessage, problem);
    }

    const button = $('#resendBtn');
    button.disabled = true;
    try {
        await api.resendVerifyEmail({ email: pendingEmail, captchaToken: tokenOf('verify') });
        resetCaptcha('verify');
        showFormMessage(verifyMessage, '验证码已重新发送，请查收邮件', 'success');
        startResendCountdown();
    } catch (err) {
        showFormMessage(verifyMessage, err.message);
        button.disabled = false;
    }
});

$('#backToLogin').addEventListener('click', hideVerifyPanel);

/* ---------------- 初始化 ---------------- */

initCaptcha();

if (store.isLoggedIn()) {
    api.me()
        .then(() => location.replace(PAGES.dashboard))
        .catch(() => {});
}
