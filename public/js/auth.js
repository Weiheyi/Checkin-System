import { api } from './api.js';
import { store } from './store.js';
import { PAGES } from './config.js';
import { $, $$, showFormMessage, setLoading } from './ui.js';

const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const loginMessage = $('#loginMessage');
const registerMessage = $('#registerMessage');

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

$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function enterApp() {
    location.href = PAGES.dashboard;
}

loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;

    if (!email || !password) {
        return showFormMessage(loginMessage, '请填写邮箱和密码');
    }

    const button = $('button[type=submit]', loginForm);
    setLoading(button, true);
    try {
        await api.login({ email, password });
        enterApp();
    } catch (err) {
        showFormMessage(loginMessage, err.message);
    } finally {
        setLoading(button, false);
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

    const button = $('button[type=submit]', registerForm);
    setLoading(button, true);
    try {
        const result = await api.register({ email, nickname, password });
        // 开启了邮箱验证时，注册后需要先去邮箱确认
        if (result && result.pending) {
            switchTab('login');
            showFormMessage(loginMessage, result.message, 'success');
            return;
        }
        enterApp();
    } catch (err) {
        showFormMessage(registerMessage, err.message);
    } finally {
        setLoading(button, false);
    }
});

if (store.isLoggedIn()) {
    api.me()
        .then(() => location.replace(PAGES.dashboard))
        .catch(() => {});
}
