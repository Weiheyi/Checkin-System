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

function enterApp(session) {
    store.setToken(session.token);
    store.setUser(session.user);
    location.href = PAGES.dashboard;
}

loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;

    if (!username || !password) {
        return showFormMessage(loginMessage, '请填写用户名和密码');
    }

    const button = $('button[type=submit]', loginForm);
    setLoading(button, true);
    try {
        enterApp(await api.login({ username, password }));
    } catch (err) {
        showFormMessage(loginMessage, err.message);
    } finally {
        setLoading(button, false);
    }
});

registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#regUsername').value.trim();
    const nickname = $('#regNickname').value.trim();
    const password = $('#regPassword').value;
    const passwordConfirm = $('#regPasswordConfirm').value;

    if (!username) {
        return showFormMessage(registerMessage, '用户名不能为空');
    }
    if (password !== passwordConfirm) {
        return showFormMessage(registerMessage, '两次密码输入不一致');
    }

    const button = $('button[type=submit]', registerForm);
    setLoading(button, true);
    try {
        enterApp(await api.register({ username, nickname, password }));
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
