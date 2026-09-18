import { api } from './api.js';
import { store } from './store.js';
import { PAGES } from './config.js';
import { $, $$, showFormMessage, setLoading } from './ui.js';
import { createMathCaptcha } from './math-captcha.js';
import './theme.js';

const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const loginMessage = $('#loginMessage');
const registerMessage = $('#registerMessage');

/* ---------------- 人机验证 ---------------- */

// 四则运算。纯前端校验，挡住最明显的脚本提交
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

// 返回未通过的提示，通过则返回空字符串（运算题答错时会自动换题）
function humanProblem(name) {
    return mathCaptchas[name].check();
}

// 提交结束后复位验证，为下一次提交做准备
function resetHumanCheck(name) {
    mathCaptchas[name].refresh();
}

/* ---------------- 面板切换 ---------------- */

// name: 'login' | 'register'
function showPanel(name) {
    loginForm.classList.toggle('hidden', name !== 'login');
    registerForm.classList.toggle('hidden', name !== 'register');

    $$('.tab').forEach(tab => {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
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
        await api.login({ email, password });
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
        await api.register({ email, nickname, password });
        enterApp();
    } catch (err) {
        showFormMessage(registerMessage, err.message);
    } finally {
        setLoading(button, false);
        resetHumanCheck('register');
    }
});

/* ---------------- 初始化 ---------------- */

if (store.isLoggedIn()) {
    api.me()
        .then(() => location.replace(PAGES.dashboard))
        .catch(() => {});
}
