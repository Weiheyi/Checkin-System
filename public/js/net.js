// 在线 / 离线双模式，以及断网期间的本地缓存与待同步队列
//
// 页面照常调用 api.xxx()，由 api.js 决定走网络还是走这里。
//
// 三种「离线」统一处理：
//   1. 用户主动切到离线模式（mode = 'offline'）
//   2. 浏览器报告没有网络（navigator.onLine === false）
//   3. 刚才有请求失败（networkDown）—— 先按离线走，下一次请求成功就自动恢复
//
// 离线期间的写入：先改本地缓存（界面照常更新），再记一条待同步。
// 能合并的条目都合并（同一天打卡一条、同一个任务的改动只留最后一条……），
// 联网后按入队顺序重放。任何情况下都不静默丢弃：某条失败就停下、整条保留、可重试。

import { store } from './store.js';

const MODE_KEY = 'checkin_net_mode';
const OFFLINE_PREFIX = 'checkin_offline_';

let currentMode = readMode();
let networkDown = false;
let syncPromise = null;
let lastError = '';
let inited = false;

const listeners = new Set();
const handlers = new Map();

/* ---------------- 存储 ---------------- */

// 缓存与队列都按用户隔离，换账号不会看到别人的数据
function keyOf(name) {
    const user = store.getUser();
    return `${OFFLINE_PREFIX}${(user && user.id) || 'anon'}_${name}`;
}

function readStorage(name, fallback) {
    try {
        const raw = localStorage.getItem(keyOf(name));
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeStorage(name, value) {
    try {
        localStorage.setItem(keyOf(name), JSON.stringify(value));
        return true;
    } catch {
        // 空间满了或隐私模式：离线能力降级，但不影响在线使用
        return false;
    }
}

function dropStorage(name) {
    try {
        localStorage.removeItem(keyOf(name));
    } catch {
        /* 忽略 */
    }
}

/* ---------------- 模式 ---------------- */

function readMode() {
    try {
        return localStorage.getItem(MODE_KEY) === 'offline' ? 'offline' : 'online';
    } catch {
        return 'online';
    }
}

// 用户选的那一档
export function mode() {
    return currentMode;
}

// 请求失败过、但浏览器还没报告断网的情况
export function networkTrouble() {
    return networkDown;
}

// 实际是否按离线处理
export function isOffline() {
    return currentMode === 'offline' || !navigator.onLine || networkDown;
}

export function setMode(next) {
    const value = next === 'offline' ? 'offline' : 'online';
    if (value === currentMode) return currentMode;

    currentMode = value;
    if (value === 'online') networkDown = false;

    try {
        localStorage.setItem(MODE_KEY, value);
    } catch {
        /* 忽略 */
    }

    notify();
    if (value === 'online') sync().catch(() => {});
    return currentMode;
}

/* ---------------- 订阅 ---------------- */

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify() {
    for (const fn of [...listeners]) {
        try {
            fn();
        } catch {
            /* 单个订阅出错不影响其他订阅者 */
        }
    }
}

/* ---------------- 读缓存 ---------------- */

export function cacheValue(name) {
    const value = readStorage(name, undefined);
    return value === null ? undefined : value;
}

export function setCacheValue(name, value) {
    return writeStorage(name, value);
}

export function dropCache(name) {
    dropStorage(name);
}

// 在线：走网络并把结果缓存下来；离线：直接用缓存
export async function cached(name, loader) {
    const hit = cacheValue(name);

    if (currentMode === 'offline' || !navigator.onLine) {
        if (hit === undefined) {
            throw new Error('离线模式：本地还没有这部分数据，联网打开一次就能离线看了');
        }
        return hit;
    }

    try {
        const value = await loader();
        if (networkDown) {
            networkDown = false;
            notify();
        }
        setCacheValue(name, value);

        // 刚才有请求成功，说明网可能回来了，顺手把攒着的改动补传一下
        if (pendingCount()) sync().catch(() => {});
        return value;
    } catch (error) {
        if (hit === undefined) throw error;

        // 请求挂了但本地有数据：先用着，并标记网络异常
        if (!networkDown) {
            networkDown = true;
            notify();
        }
        return hit;
    }
}

/* ---------------- 待同步队列 ---------------- */

export function localId(prefix = 'local') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pending() {
    return readStorage('outbox', []);
}

export function pendingCount() {
    return pending().length;
}

export function syncingNow() {
    return !!syncPromise;
}

export function lastSyncError() {
    return lastError;
}

// 能合并的条目就地合并，避免重放时产生重复数据
function mergeOutbox(list, entry) {
    const findLast = test => {
        for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
        return -1;
    };

    if (entry.kind === 'checkin') {
        const i = findLast(op => op.kind === 'checkin' && op.day === entry.day);
        if (i >= 0) list[i] = entry;
        else list.push(entry);
        return;
    }

    if (entry.kind === 'task.add') {
        // 离线新建的任务：之后勾选 / 删除都改这一条（删除后同步时跳过）
        const i = findLast(op => op.kind === 'task.add' && op.localId === entry.localId);
        if (i >= 0) list[i] = entry;
        else list.push(entry);
        return;
    }

    if (entry.kind === 'task.update' || entry.kind === 'task.remove') {
        const i = findLast(op => (op.kind === 'task.update' || op.kind === 'task.remove') && op.id === entry.id);
        if (i >= 0) list[i] = entry;
        else list.push(entry);
        return;
    }

    if (entry.kind === 'words.add') {
        // 同一本单词本只留一条，并顺手把重复的词去掉（离线时判不了重，先在这里挡一道）
        const i = findLast(op => op.kind === 'words.add' && op.bookId === entry.bookId);
        if (i < 0) {
            list.push(entry);
            return;
        }

        const seen = new Set(list[i].words.map(word => word.term.trim().toLowerCase()));
        for (const word of entry.words || []) {
            const key = word.term.trim().toLowerCase();
            if (seen.has(key)) continue;
            list[i].words.push(word);
            seen.add(key);
        }
        list[i].at = entry.at;
        return;
    }

    if (entry.kind === 'study') {
        // 同一轮背诵 / 考核的逐词作答并到一条里，同步时一次性建会话
        const i = findLast(op => op.kind === 'study' && op.runId === entry.runId);
        if (i >= 0) {
            list[i].reviews.push(...(entry.reviews || []));
            list[i].total = Math.max(list[i].total || 0, entry.total || 0);
            list[i].at = entry.at;
        } else {
            list.push(entry);
        }
        return;
    }

    list.push(entry);
}

export function enqueue(op) {
    const list = pending();
    mergeOutbox(list, { ...op, at: op.at || Date.now() });
    const ok = writeStorage('outbox', list);
    notify();
    return { ok, count: list.length };
}

// 每条待同步类型由 api.js 注册处理函数（net.js 不直接碰 Supabase）
export function registerSyncHandler(kind, handler) {
    handlers.set(kind, handler);
}

// 同一时刻只跑一次同步，重复调用共享同一个 promise
export function sync() {
    if (syncPromise) return syncPromise;
    if (currentMode === 'offline' || !navigator.onLine) {
        return Promise.resolve({ synced: 0, failed: 0, skipped: true });
    }
    if (!pendingCount()) return Promise.resolve({ synced: 0, failed: 0 });

    syncPromise = runSync().finally(() => {
        syncPromise = null;
        notify();
    });
    notify();
    return syncPromise;
}

async function runSync() {
    let synced = 0;
    let failed = 0;
    lastError = '';

    try {
        // 每次只取队首，成功一条才移出去：中途失败既不会丢也不会重复
        for (;;) {
            const op = pending()[0];
            if (!op) break;

            try {
                const handler = handlers.get(op.kind);
                if (!handler) throw new Error(`不认识的待同步类型：${op.kind}`);
                await handler(op);
            } catch (error) {
                failed = pendingCount();
                lastError = error.message || '同步失败';
                break;
            }

            writeStorage('outbox', pending().slice(1));
            synced += 1;
        }
    } finally {
        // 统计和历史在离线期间是本地估算的，同步完丢掉缓存，下次读到服务端的精确值
        if (synced) {
            dropCache('stats');
            dropCache('history');
        }
    }

    return { synced, failed };
}

/* ---------------- 初始化 ---------------- */

export function initNet() {
    if (inited) return;
    inited = true;

    window.addEventListener('online', () => {
        notify();
        sync().catch(() => {});
    });
    window.addEventListener('offline', notify);

    // 打开页面时如果在线，顺手补传上次没传完的
    if (navigator.onLine && currentMode === 'online' && pendingCount()) {
        sync().catch(() => {});
    }
}
