import { api } from './api.js';
import { store } from './store.js';
import { $, toast, setLoading, formatDateZh, skeletonRows } from './ui.js';
import { initShell, setShellUser, setShellSub } from './shell.js';

const state = { checkin: null, tasks: [], stats: null, history: [] };
const els = {};
// 简单的在途锁，避免用户连点产生重复请求
const busy = new Set();

function cacheElements() {
    els.currentDate = $('#currentDate');
    els.checkInBtn = $('#checkInBtn');
    els.taskSection = $('#taskSection');
    els.taskInput = $('#taskInput');
    els.addTaskBtn = $('#addTaskBtn');
    els.taskList = $('#taskList');
    els.taskEmpty = $('#taskEmpty');
    els.totalDays = $('#totalDays');
    els.streakDays = $('#streakDays');
    els.completedTasks = $('#completedTasks');
    els.completionRate = $('#completionRate');
    els.historyList = $('#historyList');
    els.historyEmpty = $('#historyEmpty');
}

function renderCheckinState() {
    const checked = !!state.checkin;
    els.checkInBtn.textContent = checked ? '✓ 已打卡' : '今日打卡';
    els.checkInBtn.classList.toggle('checked', checked);
    els.checkInBtn.disabled = checked;
    els.taskSection.hidden = !checked;
}

function renderTasks() {
    const fragment = document.createDocumentFragment();

    state.tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item' + (task.completed ? ' completed' : '');

        const check = document.createElement('label');
        check.className = 'task-check';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.addEventListener('change', () => toggleTask(task));

        const mark = document.createElement('span');
        mark.className = 'task-checkmark';

        check.append(checkbox, mark);

        const text = document.createElement('span');
        text.className = 'task-text';
        text.textContent = task.content;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-btn';
        del.textContent = '删除';
        del.setAttribute('aria-label', '删除任务');
        del.addEventListener('click', () => deleteTask(task));

        li.append(check, text, del);
        fragment.appendChild(li);
    });

    els.taskList.replaceChildren(fragment);
    els.taskEmpty.hidden = state.tasks.length > 0;
}

function renderStats() {
    const stats = state.stats;
    if (!stats) return;

    els.totalDays.textContent = stats.totalDays;
    els.streakDays.textContent = stats.streak;
    els.completedTasks.textContent = stats.completedTasks;
    els.completionRate.textContent = stats.completionRate + '%';
    setShellSub(stats.streak > 0 ? `已连续打卡 ${stats.streak} 天` : '今天开始你的打卡');
}

function renderHistory() {
    const fragment = document.createDocumentFragment();

    state.history.forEach(item => {
        const total = item.taskCount;
        const done = item.completedTaskCount;
        const rate = total ? Math.round((done / total) * 100) : 0;

        const card = document.createElement('div');
        card.className = 'history-item';

        const head = document.createElement('div');
        head.className = 'history-head';

        const date = document.createElement('span');
        date.className = 'history-date';
        date.textContent = item.checkin_date;

        const count = document.createElement('span');
        count.className = 'history-count';
        count.textContent = total ? `完成 ${done}/${total}` : '无任务';

        head.append(date, count);

        const progress = document.createElement('div');
        progress.className = 'progress';
        const fill = document.createElement('div');
        fill.className = 'progress-fill';
        fill.style.width = rate + '%';
        progress.appendChild(fill);

        card.append(head, progress);
        fragment.appendChild(card);
    });

    els.historyList.replaceChildren(fragment);
    els.historyEmpty.hidden = state.history.length > 0;
}

async function loadToday() {
    try {
        const data = await api.getToday();
        state.checkin = data.checkin;
        state.tasks = data.tasks || [];
        renderCheckinState();
        renderTasks();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function loadStats() {
    try {
        state.stats = await api.stats();
    } catch {
        // 离线且本地还没缓存过统计：先不显示，不影响打卡与任务
        state.stats = null;
    }
    renderStats();
}

async function loadHistory() {
    try {
        state.history = await api.history(10);
    } catch {
        state.history = [];
    }
    renderHistory();
}

async function refreshSummary() {
    await Promise.all([loadStats(), loadHistory()]);
}

// 任务的增删改只会影响「任务数 / 完成数」这两项统计，
// 所以在本地做增量更新即可，不必每次都把统计和历史整批重新拉一遍。
// 单日增减量为参数：totalDelta 表示任务总数变化，doneDelta 表示已完成数变化。
function applyTaskDelta(totalDelta, doneDelta) {
    const stats = state.stats;
    if (stats) {
        stats.totalTasks = Math.max(0, stats.totalTasks + totalDelta);
        stats.completedTasks = Math.max(0, stats.completedTasks + doneDelta);
        stats.completionRate = stats.totalTasks
            ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
            : 0;
        renderStats();
    }

    const today = state.checkin && state.checkin.checkin_date;
    const entry = today && state.history.find(item => item.checkin_date === today);
    if (entry) {
        entry.taskCount = Math.max(0, entry.taskCount + totalDelta);
        entry.completedTaskCount = Math.max(0, entry.completedTaskCount + doneDelta);
        renderHistory();
    }
}

async function handleCheckIn() {
    if (busy.has('checkin')) return;
    busy.add('checkin');
    setLoading(els.checkInBtn, true);
    try {
        const { checkin } = await api.checkIn();
        state.checkin = checkin;
        state.tasks = [];
        renderTasks();
        toast('打卡成功！累了就去玩个小游戏放松一下吧 🎮', 'success');
        await refreshSummary();
    } catch (err) {
        toast(err.message, 'error');
        await loadToday();
    } finally {
        busy.delete('checkin');
        setLoading(els.checkInBtn, false);
        renderCheckinState();
    }
}

async function addTask() {
    if (busy.has('tasks')) return;
    const content = els.taskInput.value.trim();
    if (!content) {
        return toast('请输入任务内容', 'error');
    }
    if (!state.checkin) {
        return toast('请先打卡', 'error');
    }

    busy.add('tasks');
    setLoading(els.addTaskBtn, true);
    try {
        const { task } = await api.tasks.add(content);
        state.tasks.push(task);
        els.taskInput.value = '';
        renderTasks();
        applyTaskDelta(1, 0);
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        busy.delete('tasks');
        setLoading(els.addTaskBtn, false);
    }
}

async function toggleTask(task) {
    if (busy.has('tasks')) {
        renderTasks();
        return;
    }
    busy.add('tasks');
    const completed = !task.completed;
    try {
        const { task: updated } = await api.tasks.toggle(task.id, completed);
        Object.assign(task, updated);
        renderTasks();
        applyTaskDelta(0, completed ? 1 : -1);
    } catch (err) {
        toast(err.message, 'error');
        renderTasks();
    } finally {
        busy.delete('tasks');
    }
}

async function deleteTask(task) {
    if (busy.has('tasks')) return;
    busy.add('tasks');
    try {
        await api.tasks.remove(task.id);
        state.tasks = state.tasks.filter(t => t.id !== task.id);
        renderTasks();
        applyTaskDelta(-1, task.completed ? -1 : 0);
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        busy.delete('tasks');
    }
}

async function init() {
    cacheElements();
    els.currentDate.textContent = formatDateZh();
    els.historyList.replaceChildren(skeletonRows(3));

    els.checkInBtn.addEventListener('click', handleCheckIn);
    els.addTaskBtn.addEventListener('click', addTask);
    els.taskInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') addTask();
    });

    // 老版本缓存里没有头像字段，补一次资料刷新即可
    const cached = store.getUser();
    if (cached && cached.avatar_emoji === undefined) {
        api.me().then(({ user }) => setShellUser(user)).catch(() => {});
    }

    try {
        await Promise.all([loadToday(), loadStats(), loadHistory()]);
    } catch {
        // requireUser 已经跳回登录页，这里无需再处理
    }
}

if (initShell({ active: 'dashboard' })) init();
