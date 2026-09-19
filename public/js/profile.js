import { api } from './api.js';
import { store } from './store.js';
import { AVATAR_CHOICES } from './config.js';
import { getTheme, setTheme } from './theme.js';
import { $, $$, toast, setLoading, paintAvatar } from './ui.js';
import { initShell, setShellUser, setBackgroundOpacity, logout } from './shell.js';
import { cropImage } from './image-crop.js';

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

    els.feedbackForm = $('#feedbackForm');
    els.feedbackInput = $('#feedbackInput');
    els.feedbackContact = $('#feedbackContact');
    els.feedbackList = $('#feedbackList');

    els.avatarUploadBtn = $('#avatarUploadBtn');
    els.avatarRemoveBtn = $('#avatarRemoveBtn');
    els.avatarFile = $('#avatarFile');
    els.bgUploadBtn = $('#bgUploadBtn');
    els.bgRemoveBtn = $('#bgRemoveBtn');
    els.bgFile = $('#bgFile');
    els.bgOpacityRow = $('#bgOpacityRow');
    els.bgOpacity = $('#bgOpacity');
    els.bgOpacityValue = $('#bgOpacityValue');
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

    // 外观：有图才显示「移除」，有背景才显示透明度滑块
    els.avatarRemoveBtn.classList.toggle('hidden', !user.avatar_url);
    els.bgRemoveBtn.classList.toggle('hidden', !user.background_url);
    els.bgOpacityRow.hidden = !user.background_url;

    const opacity = user.background_opacity == null ? 100 : user.background_opacity;
    els.bgOpacity.value = String(opacity);
    els.bgOpacityValue.textContent = `${opacity}%`;

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

/* ---------------- 意见反馈 ---------------- */

function renderFeedbackList(items) {
    els.feedbackList.replaceChildren();

    if (!items.length) {
        els.feedbackList.className = 'feedback-list empty-hint';
        els.feedbackList.textContent = '还没有提交过反馈。';
        return;
    }

    els.feedbackList.className = 'feedback-list';
    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'feedback-item';

        const head = document.createElement('div');
        head.className = 'feedback-head';

        const time = document.createElement('span');
        time.className = 'feedback-time';
        time.textContent = new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-ghost feedback-delete';
        del.textContent = '删除';
        del.addEventListener('click', () => removeFeedback(item));

        head.append(time, del);

        const text = document.createElement('div');
        text.className = 'feedback-text';
        text.textContent = item.content;

        row.append(head, text);

        if (item.contact) {
            const contact = document.createElement('div');
            contact.className = 'feedback-contact';
            contact.textContent = `联系方式：${item.contact}`;
            row.appendChild(contact);
        }

        fragment.appendChild(row);
    });

    els.feedbackList.appendChild(fragment);
}

async function loadFeedback() {
    try {
        renderFeedbackList(await api.feedback.list());
    } catch (err) {
        els.feedbackList.className = 'feedback-list';
        els.feedbackList.textContent = err.message;
    }
}

async function submitFeedback(event) {
    event.preventDefault();

    const content = els.feedbackInput.value.trim();
    if (!content) return toast('请先写点内容', 'error');

    const button = $('button[type=submit]', els.feedbackForm);
    setLoading(button, true);
    try {
        await api.feedback.create({ content, contact: els.feedbackContact.value });
        els.feedbackInput.value = '';
        els.feedbackContact.value = '';
        toast('反馈已提交，谢谢！', 'success');
        await loadFeedback();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(button, false);
    }
}

async function removeFeedback(item) {
    try {
        await api.feedback.remove(item.id);
        toast('已删除', 'success');
        await loadFeedback();
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ---------------- 外观：头像图片与自定义背景 ---------------- */

// 选文件 → 裁剪 → 上传 → 刷新资料
function setupImageUpload({ button, input, kind, crop, done }) {
    button.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;

        let blob;
        try {
            blob = await cropImage(file, crop);
        } catch (err) {
            return toast(err.message, 'error');
        }
        if (!blob) return; // 用户取消了裁剪

        setLoading(button, true);
        try {
            const { profile } = await api.profile.saveImage(kind, blob);
            applyUser({
                ...currentUser,
                avatar_url: profile.avatar_url || '',
                background_url: profile.background_url || ''
            });
            toast(done, 'success');
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setLoading(button, false);
        }
    });
}

async function removeImage(kind, button) {
    setLoading(button, true);
    try {
        const { profile } = await api.profile.clearImage(kind);
        applyUser({
            ...currentUser,
            avatar_url: profile.avatar_url || '',
            background_url: profile.background_url || ''
        });
        toast('已移除', 'success');
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
    els.feedbackForm.addEventListener('submit', submitFeedback);

    $$('#themeGroup button').forEach(btn => {
        btn.addEventListener('click', () => {
            setTheme(btn.dataset.theme);
            renderThemeGroup();
        });
    });

    // 顶部栏切换主题时，这里的选中状态也要跟着变
    window.addEventListener('themechange', renderThemeGroup);

    els.togglePasswordBtn.addEventListener('click', () => {
        const hidden = els.passwordForm.classList.toggle('hidden');
        els.togglePasswordBtn.textContent = hidden ? '修改' : '取消';
        if (!hidden) els.newPassword.focus();
    });

    els.logoutSetting.addEventListener('click', logout);

    // 外观：头像 / 背景上传与裁剪、背景透明度
    setupImageUpload({
        button: els.avatarUploadBtn,
        input: els.avatarFile,
        kind: 'avatar',
        crop: { aspect: 1, outputWidth: 320, title: '裁剪头像' },
        done: '头像已更新'
    });
    setupImageUpload({
        button: els.bgUploadBtn,
        input: els.bgFile,
        kind: 'background',
        crop: { aspect: 16 / 9, outputWidth: 1600, quality: 0.75, title: '裁剪背景' },
        done: '背景已更新'
    });

    els.avatarRemoveBtn.addEventListener('click', () => removeImage('avatar', els.avatarRemoveBtn));
    els.bgRemoveBtn.addEventListener('click', () => removeImage('background', els.bgRemoveBtn));

    // 拖动时先本地预览，松手才写库，避免一路拖一路发请求
    els.bgOpacity.addEventListener('input', () => {
        const value = Number(els.bgOpacity.value);
        els.bgOpacityValue.textContent = `${value}%`;
        setBackgroundOpacity(value);
    });
    els.bgOpacity.addEventListener('change', async () => {
        const value = Number(els.bgOpacity.value);
        try {
            await api.profile.update({ background_opacity: value });
            currentUser = { ...currentUser, background_opacity: value };
        } catch (err) {
            toast(err.message, 'error');
        }
    });
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
        await loadFeedback();
    } catch (err) {
        toast(err.message, 'error');
    }
}

if (initShell({ active: 'profile' })) init();
