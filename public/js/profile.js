import { api } from './api.js';
import { store } from './store.js';
import { AVATAR_CHOICES } from './config.js';
import { getTheme, setTheme } from './theme.js';
import { $, $$, toast, setLoading, paintAvatar } from './ui.js';
import { initShell, setShellUser, logout } from './shell.js';

const els = {};
let currentUser = null;
let chosenAvatar = '';

function cacheElements() {
    els.avatar = $('#profileAvatar');
    els.name = $('#profileName');
    els.email = $('#profileEmail');
    els.joinedText = $('#joinedText');

    els.profileForm = $('#profileForm');
    els.avatarPicker = $('#avatarPicker');
    els.nicknameInput = $('#nicknameInput');
    els.bioInput = $('#bioInput');

    els.streakDays = $('#streakDays');
    els.totalDays = $('#totalDays');
    els.completedTasks = $('#completedTasks');
    els.completionRate = $('#completionRate');

    els.themeGroup = $('#themeGroup');
    els.togglePasswordBtn = $('#togglePasswordBtn');
    els.passwordForm = $('#passwordForm');
    els.newPassword = $('#newPassword');
    els.confirmPassword = $('#confirmPassword');
    els.logoutSetting = $('#logoutSetting');
}

/* ---------------- 资料 ---------------- */

function renderAvatarPicker() {
    const fragment = document.createDocumentFragment();

    ['', ...AVATAR_CHOICES].forEach(value => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'avatar-choice' + (value === chosenAvatar ? ' active' : '');
        btn.dataset.value = value;
        btn.textContent = value || '字';
        if (!value) {
            btn.title = '使用昵称首字';
            btn.setAttribute('aria-label', '使用昵称首字');
        }
        btn.addEventListener('click', () => {
            chosenAvatar = value;
            $$('.avatar-choice', els.avatarPicker).forEach(item => {
                item.classList.toggle('active', item.dataset.value === value);
            });
        });
        fragment.appendChild(btn);
    });

    els.avatarPicker.replaceChildren(fragment);
}

// 统一的「用户信息变化」出口：同步头像区、表单、缓存和顶部栏
function applyUser(user) {
    currentUser = user;
    chosenAvatar = user.avatar_emoji || '';

    paintAvatar(els.avatar, user);
    els.name.textContent = user.nickname || '用户';
    els.email.textContent = user.email || '';
    els.nicknameInput.value = user.nickname || '';
    els.bioInput.value = user.bio || '';
    renderAvatarPicker();

    setShellUser(user);
}

async function saveProfile(event) {
    event.preventDefault();

    const nickname = els.nicknameInput.value.trim();
    const bio = els.bioInput.value.trim();

    if (!nickname) return toast('昵称不能为空', 'error');

    const button = $('button[type=submit]', els.profileForm);
    setLoading(button, true);
    try {
        const { profile } = await api.profile.update({
            nickname,
            avatar_emoji: chosenAvatar,
            bio
        });
        applyUser({
            ...currentUser,
            nickname: profile.nickname,
            avatar_emoji: profile.avatar_emoji || '',
            bio: profile.bio || ''
        });
        toast('资料已保存', 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(button, false);
    }
}

/* ---------------- 数据 ---------------- */

function renderStats(stats) {
    els.streakDays.textContent = stats.streak;
    els.totalDays.textContent = stats.totalDays;
    els.completedTasks.textContent = stats.completedTasks;
    els.completionRate.textContent = stats.completionRate + '%';
}

function renderJoined(user) {
    if (!user.joined_at) {
        els.joinedText.hidden = true;
        return;
    }
    const date = new Date(user.joined_at);
    els.joinedText.hidden = false;
    els.joinedText.textContent = `加入于 ${date.toLocaleDateString('zh-CN')}`;
}

/* ---------------- 设置 ---------------- */

function renderThemeGroup() {
    const theme = getTheme();
    $$('#themeGroup button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

async function savePassword(event) {
    event.preventDefault();

    const password = els.newPassword.value;
    const confirm = els.confirmPassword.value;

    if (password.length < 6) return toast('密码至少 6 位', 'error');
    if (password !== confirm) return toast('两次输入的密码不一致', 'error');

    const button = $('button[type=submit]', els.passwordForm);
    setLoading(button, true);
    try {
        await api.profile.changePassword(password);
        els.newPassword.value = '';
        els.confirmPassword.value = '';
        els.passwordForm.classList.add('hidden');
        els.togglePasswordBtn.textContent = '修改';
        toast('密码已更新', 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(button, false);
    }
}

/* ---------------- 初始化 ---------------- */

function bindEvents() {
    els.profileForm.addEventListener('submit', saveProfile);
    els.passwordForm.addEventListener('submit', savePassword);

    $$('#themeGroup button').forEach(btn => {
        btn.addEventListener('click', () => {
            setTheme(btn.dataset.theme);
            renderThemeGroup();
        });
    });

    els.togglePasswordBtn.addEventListener('click', () => {
        const hidden = els.passwordForm.classList.toggle('hidden');
        els.togglePasswordBtn.textContent = hidden ? '修改' : '取消';
        if (!hidden) els.newPassword.focus();
    });

    els.logoutSetting.addEventListener('click', logout);
}

async function init() {
    cacheElements();
    bindEvents();
    renderThemeGroup();

    // 先用缓存渲染，避免空白；随后拉一次最新资料
    const cached = store.getUser();
    if (cached) applyUser(cached);

    try {
        const [{ user }, stats] = await Promise.all([api.me(), api.stats()]);
        applyUser(user);
        renderStats(stats);
        renderJoined(user);
    } catch (err) {
        toast(err.message, 'error');
    }
}

if (initShell({ active: 'profile' })) init();
