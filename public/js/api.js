import { supabase } from './supabase.js';
import { PAGES } from './config.js';
import { store } from './store.js';
import * as net from './net.js';

function goToLogin() {
    if (!location.pathname.endsWith(PAGES.login)) {
        location.replace(PAGES.login);
    }
}

function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

// 本地 YYYY-MM-DD，避免用 toISOString 取到 UTC 日期而跨日错位
function todayStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 读取本地会话中的用户；无会话则清理并跳回登录页
async function requireUser() {
    const { data } = await supabase.auth.getSession();
    const session = data && data.session;
    if (!session) {
        store.clear();
        goToLogin();
        fail('登录已过期，请重新登录', 401);
    }
    return session.user;
}

async function buildUser(user) {
    const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar_emoji, avatar_url, background_url, background_mobile_url, background_opacity, bio, created_at')
        .eq('id', user.id)
        .maybeSingle();

    return {
        id: user.id,
        email: user.email,
        nickname: (data && data.nickname) || (user.email || '').split('@')[0] || '用户',
        avatar_emoji: (data && data.avatar_emoji) || '',
        avatar_url: (data && data.avatar_url) || '',
        background_url: (data && data.background_url) || '',
        background_mobile_url: (data && data.background_mobile_url) || '',
        background_opacity: data && data.background_opacity != null ? data.background_opacity : 100,
        bio: (data && data.bio) || '',
        joined_at: (data && data.created_at) || user.created_at || null
    };
}

// 三种图片对应的资料字段与存储路径（文件名即 kind）
const IMAGE_FIELDS = {
    avatar: 'avatar_url',
    background: 'background_url',
    'background-mobile': 'background_mobile_url'
};

// 头像 / 背景图存在 Storage 的公开桶里，路径固定为 <用户id>/<kind>.jpg，
// 覆盖同名文件后加时间戳，避免浏览器与 CDN 继续用旧图
const MEDIA_BUCKET = 'media';

async function uploadImage(kind, blob) {
    const user = await requireUser();
    const path = `${user.id}/${kind}.jpg`;

    const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) fail(error.message, 500);

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
}

function mapCheckin(row) {
    return {
        id: row.id,
        user_id: row.user_id,
        checkin_date: row.checkin_date,
        content: row.content,
        created_at: row.created_at
    };
}

function mapTask(row) {
    return {
        id: row.id,
        user_id: row.user_id,
        checkin_id: row.checkin_id,
        content: row.content,
        completed: row.completed,
        created_at: row.created_at
    };
}

function mapWord(row) {
    return {
        id: row.id,
        book_id: row.book_id,
        position: row.position || 0,
        term: row.term,
        meaning: row.meaning || '',
        mastery: row.mastery || 0,
        review_count: row.review_count || 0,
        correct_count: row.correct_count || 0,
        wrong_count: row.wrong_count || 0,
        last_result: row.last_result || '',
        last_reviewed_at: row.last_reviewed_at || null
    };
}

function mapBook(row) {
    const embedded = row.words && row.words[0];
    return {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        wordCount: embedded ? Number(embedded.count) : 0
    };
}

function mapFeedback(row) {
    return {
        id: row.id,
        content: row.content,
        contact: row.contact || '',
        createdAt: row.created_at
    };
}

function mapSession(row) {
    return {
        id: row.id,
        book_id: row.book_id || null,
        bookName: row.book_name || '',
        mode: row.mode,
        total: row.total || 0,
        known: row.known || 0,
        vague: row.vague || 0,
        again: row.again || 0,
        correct: row.correct || 0,
        wrong: row.wrong || 0,
        createdAt: row.created_at
    };
}

function mapVocabTest(row) {
    return {
        id: row.id,
        estimate: row.estimate || 0,
        low: row.low || 0,
        high: row.high || 0,
        total: row.total || 0,
        known: row.known || 0,
        durationMs: row.duration_ms || 0,
        bands: Array.isArray(row.bands) ? row.bands : [],
        createdAt: row.created_at
    };
}

async function getTodayCheckin(userId) {
    const { data, error } = await supabase
        .from('checkins')
        .select('*')
        .eq('user_id', userId)
        .eq('checkin_date', todayStr())
        .maybeSingle();

    if (error) fail(error.message, 500);
    return data;
}

function translateAuthError(error) {
    const message = (error && error.message) || '操作失败';
    if (/Invalid login credentials/i.test(message)) return '邮箱或密码错误';
    if (/User already registered|already been registered/i.test(message)) return '该邮箱已注册，请直接登录';
    if (/captcha/i.test(message)) return '人机验证未通过，请刷新页面后重试';
    if (/Password should be at least/i.test(message)) return '密码至少 6 位';
    if (/valid email/i.test(message)) return '邮箱格式不正确';
    if (/rate limit|too many requests/i.test(message)) return '操作过于频繁，请稍后再试';
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return '网络异常，请检查网络或 Supabase 配置';
    // 数据库 RPC 里 raise exception 的中文提示，去掉 PostgREST 可能带上的前缀
    return message.replace(/^[A-Z0-9]{5}:\s*/, '');
}

// 好友关系表按 user_a < user_b 存，统一算出顺序，保证两边对同一对好友得到同一行
function orderedPair(idA, idB) {
    return idA < idB ? [idA, idB] : [idB, idA];
}

/* ---------------- 离线：本地缓存与待同步队列 ---------------- */

function emptyToday() {
    return { checked: false, checkin: null, tasks: [] };
}

function readToday() {
    return net.cacheValue('today') || emptyToday();
}

function writeToday(value) {
    net.setCacheValue('today', value);
    return value;
}

// 在线写入之后也要把本地缓存改一下，否则同一次会话里切到离线就会看到旧数据
function cacheTodayChange(apply) {
    const today = net.cacheValue('today');
    if (!today) return;
    apply(today);
    net.setCacheValue('today', today);
}

function localCheckin(day, content) {
    const user = store.getUser() || {};
    return {
        id: net.localId('checkin'),
        user_id: user.id,
        checkin_date: day,
        content: content || '',
        created_at: new Date().toISOString()
    };
}

function localTask(checkinId, content, completed) {
    const user = store.getUser() || {};
    return {
        id: net.localId('task'),
        user_id: user.id,
        checkin_id: checkinId,
        content,
        completed: !!completed,
        created_at: new Date().toISOString()
    };
}

// 离线打卡 / 加任务只影响「打卡天数、连续天数、任务数、完成数」，
// 在本地做增量即可，和 dashboard.js 的 applyTaskDelta 是同一套口径；
// 同步完成后会把这两个缓存丢掉，下次读到服务端算出的精确值
function bumpTaskStats(totalDelta, doneDelta) {
    const stats = net.cacheValue('stats');
    if (stats) {
        stats.totalTasks = Math.max(0, (stats.totalTasks || 0) + totalDelta);
        stats.completedTasks = Math.max(0, (stats.completedTasks || 0) + doneDelta);
        stats.completionRate = stats.totalTasks
            ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
            : 0;
        net.setCacheValue('stats', stats);
    }

    const history = net.cacheValue('history');
    const day = readToday().checkin && readToday().checkin.checkin_date;
    if (!Array.isArray(history) || !day) return;

    const entry = history.find(item => item.checkin_date === day);
    if (!entry) return;

    entry.taskCount = Math.max(0, (entry.taskCount || 0) + totalDelta);
    entry.completedTaskCount = Math.max(0, (entry.completedTaskCount || 0) + doneDelta);
    net.setCacheValue('history', history);
}

function bumpCheckinStats(checkin) {
    const stats = net.cacheValue('stats');
    if (stats) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const history = net.cacheValue('history') || [];
        // 昨天也打过卡才算续上，否则从 1 重新数
        const continued = Array.isArray(history)
            && history.some(item => item.checkin_date === todayStr(yesterday));

        stats.totalDays = (stats.totalDays || 0) + 1;
        stats.streak = continued ? (stats.streak || 0) + 1 : 1;
        net.setCacheValue('stats', stats);
    }

    const history = net.cacheValue('history');
    if (!Array.isArray(history)) return;
    if (history.some(item => item.checkin_date === checkin.checkin_date)) return;

    history.unshift({
        id: checkin.id,
        checkin_date: checkin.checkin_date,
        content: checkin.content,
        created_at: checkin.created_at,
        taskCount: 0,
        completedTaskCount: 0
    });
    net.setCacheValue('history', history);
}

// 单词本详情：detail() 与 addWord() 共用
async function fetchBookDetail(id) {
    await requireUser();

    const { data: book, error } = await supabase
        .from('wordbooks')
        .select('id, name, created_at')
        .eq('id', id)
        .maybeSingle();

    if (error) fail(error.message, 500);
    if (!book) fail('单词本不存在或已被删除', 404);

    const list = await fetchAllWords(id);
    return {
        book: { id: book.id, name: book.name, created_at: book.created_at, wordCount: list.length },
        words: list
    };
}

// 同一个词不重复加：先看本地缓存，没有再拉一次详情
async function bookHasWord(bookId, term) {
    const cached = net.cacheValue(`book:${bookId}`);
    // 离线又没有缓存时判断不了，直接放行（否则离线就加不了词）
    if (!cached && net.isOffline()) return false;

    const detail = cached || (await fetchBookDetail(bookId));
    const key = term.trim().toLowerCase();
    return (detail.words || []).some(word => String(word.term).trim().toLowerCase() === key);
}

// 加入成功后把本地缓存也改掉，单词本列表和单词数立刻能看到新的
function appendToBookCache(bookId, word) {
    const cached = net.cacheValue(`book:${bookId}`);
    if (!cached || !Array.isArray(cached.words)) return;

    cached.words.push(word);
    if (cached.book) cached.book.wordCount = cached.words.length;
    net.setCacheValue(`book:${bookId}`, cached);

    const books = net.cacheValue('books');
    if (!Array.isArray(books)) return;

    const book = books.find(item => item.id === bookId);
    if (book) book.wordCount = cached.words.length;
    net.setCacheValue('books', books);
}

// 依赖联网的功能在离线时给一句能看懂的提示，而不是让用户撞上 Failed to fetch
function offlineUnsupported(name) {
    fail(`离线模式：「${name}」需要联网`, 400);
}

// 服务端返回的都是 uuid；不是 uuid 的就是离线期间本地造的 id。
// 离线新建的任务，之后的勾选 / 删除直接改队列里那条，不需要等同步拿到真实 id
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLocalTaskId(id) {
    return !SERVER_ID.test(String(id || ''));
}

function updateQueuedTask(localId, patch) {
    const entry = net.pending().find(op => op.kind === 'task.add' && op.localId === localId);
    if (entry) net.enqueue({ ...entry, ...patch });
}

function offlineToggleTask(id, completed) {
    const today = readToday();
    const task = today.tasks.find(item => item.id === id);
    if (!task) fail('这个任务在本地找不到', 404);

    const was = task.completed;
    task.completed = !!completed;
    writeToday(today);
    if (was !== task.completed) bumpTaskStats(0, task.completed ? 1 : -1);

    if (isLocalTaskId(id)) updateQueuedTask(id, { completed: task.completed });
    else net.enqueue({ kind: 'task.update', id, completed: task.completed });

    return { task };
}

function offlineRemoveTask(id) {
    const today = readToday();
    const index = today.tasks.findIndex(item => item.id === id);
    if (index < 0) return {};

    const [task] = today.tasks.splice(index, 1);
    writeToday(today);
    bumpTaskStats(-1, task.completed ? -1 : 0);

    if (isLocalTaskId(id)) updateQueuedTask(id, { deleted: true });
    else net.enqueue({ kind: 'task.remove', id });

    return {};
}

/* ---------------- 同步：把离线期间的改动补传到云端 ---------------- */

// 每天最多一条打卡记录，已经打过就当成功（唯一约束 23505）
async function ensureCheckin(day, content = '') {
    const user = await requireUser();

    const existing = await supabase
        .from('checkins')
        .select('*')
        .eq('user_id', user.id)
        .eq('checkin_date', day)
        .maybeSingle();

    if (existing.error) fail(existing.error.message, 500);
    if (existing.data) return mapCheckin(existing.data);

    const created = await supabase
        .from('checkins')
        .insert({ user_id: user.id, checkin_date: day, content: content || '' })
        .select()
        .single();

    if (created.error) {
        // 并发撞上唯一约束：重查一次，按已经打过处理
        if (created.error.code === '23505') {
            const again = await supabase
                .from('checkins')
                .select('*')
                .eq('user_id', user.id)
                .eq('checkin_date', day)
                .maybeSingle();
            if (again.data) return mapCheckin(again.data);
        }
        fail(created.error.message, 500);
    }

    return mapCheckin(created.data);
}

net.registerSyncHandler('checkin', async op => {
    await ensureCheckin(op.day, op.content);
});

net.registerSyncHandler('task.add', async op => {
    // 离线期间被删掉的任务不用补传
    if (op.deleted) return;

    const user = await requireUser();
    const checkin = await ensureCheckin(op.day);

    const { error } = await supabase.from('tasks').insert({
        user_id: user.id,
        checkin_id: checkin.id,
        content: op.content,
        completed: !!op.completed
    });

    if (error) fail(error.message, 500);
});

net.registerSyncHandler('task.update', async op => {
    // 任务被删过的话更新 0 行，也算正常结果
    const { error } = await supabase.from('tasks').update({ completed: !!op.completed }).eq('id', op.id);
    if (error) fail(error.message, 500);
});

net.registerSyncHandler('task.remove', async op => {
    const { error } = await supabase.from('tasks').delete().eq('id', op.id);
    if (error) fail(error.message, 500);
});

net.registerSyncHandler('study', async op => {
    const session = await supabase.rpc('start_study_session', {
        p_mode: op.mode,
        p_book_id: op.bookId || null,
        p_book_name: op.bookName || '',
        p_total: op.total || 0
    });

    if (session.error) fail(session.error.message, 500);

    // 熟练度仍然由服务端算，客户端不自己实现一套
    for (const review of op.reviews || []) {
        const { error } = await supabase.rpc('record_word_review', {
            p_session_id: session.data || null,
            p_word_id: review.wordId,
            p_result: review.result
        });
        if (error) fail(error.message, 500);
    }
});

net.registerSyncHandler('words.add', async op => {
    const user = await requireUser();
    const start = await nextWordPosition(op.bookId);
    await insertWords(user.id, op.bookId, op.words || [], start);

    // 丢掉缓存，下次读到的是服务端真实数据（带真实 id）
    net.dropCache(`book:${op.bookId}`);
    net.dropCache('books');
});

net.registerSyncHandler('vocab', async op => {
    const user = await requireUser();

    const { error } = await supabase.from('vocab_tests').insert({
        user_id: user.id,
        estimate: op.estimate,
        low: op.low,
        high: op.high,
        total: op.total,
        known: op.known,
        duration_ms: op.durationMs || 0,
        bands: op.bands || []
    });

    if (error) fail(error.message, 500);
});

net.registerSyncHandler('vocab.remove', async op => {
    const { error } = await supabase.from('vocab_tests').delete().eq('id', op.id);
    if (error) fail(error.message, 500);
});

export const api = {
    async register({ email, nickname, password }) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { nickname: nickname || email.split('@')[0] }
            }
        });

        if (error) fail(translateAuthError(error), 400);

        // 建站时必须在 Supabase 关闭「Confirm email」，否则 signUp 不返回会话，
        // 用户会在未登录状态下被送回登录页而不知道为什么
        if (!data.session) {
            fail('注册后未能自动登录，请在 Supabase 关闭「Confirm email」后重试', 400);
        }

        const user = await buildUser(data.user);
        store.setUser(user);
        return { user };
    },

    async login({ email, password }) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) fail(translateAuthError(error), 400);

        const user = await buildUser(data.user);
        store.setUser(user);
        return { user };
    },

    async logout() {
        await supabase.auth.signOut();
        store.clear();
    },

    async me() {
        const user = await buildUser(await requireUser());
        store.setUser(user);
        return { user };
    },

    async checkIn(content = '') {
        if (net.isOffline()) {
            const day = todayStr();
            const today = readToday();
            if (today.checkin) fail('今天已经打卡过了', 400);

            const checkin = localCheckin(day, content);
            writeToday({ checked: true, checkin, tasks: [] });
            bumpCheckinStats(checkin);
            net.enqueue({ kind: 'checkin', day, content: content || '' });

            return { checkin };
        }

        const user = await requireUser();
        const { data, error } = await supabase
            .from('checkins')
            .insert({ user_id: user.id, checkin_date: todayStr(), content: content || '' })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') fail('今天已经打卡过了', 400);
            fail(error.message, 500);
        }

        const checkin = mapCheckin(data);
        cacheTodayChange(today => {
            today.checked = true;
            today.checkin = checkin;
            today.tasks = [];
        });

        return { checkin };
    },

    async getToday() {
        return net.cached('today', async () => {
            const user = await requireUser();
            const checkin = await getTodayCheckin(user.id);
            if (!checkin) return emptyToday();

            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('checkin_id', checkin.id)
                .order('created_at', { ascending: true });

            if (error) fail(error.message, 500);

            return {
                checked: true,
                checkin: mapCheckin(checkin),
                tasks: (data || []).map(mapTask)
            };
        });
    },

    // 统计全部在数据库一次算完，替代原来的 4 次 count 请求
    async stats() {
        return net.cached('stats', async () => {
            await requireUser();

            const { data, error } = await supabase.rpc('my_stats');
            if (error) fail(error.message, 500);

            const row = (data && data[0]) || {};
            const totalTasks = row.total_tasks || 0;
            const completedTasks = row.completed_tasks || 0;

            return {
                totalDays: row.total_days || 0,
                totalTasks,
                completedTasks,
                completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
                streak: row.streak || 0
            };
        });
    },

    async history(limit = 30) {
        return net.cached('history', async () => {
            const user = await requireUser();

            const { data: checkins, error } = await supabase
                .from('checkins')
                .select('*')
                .eq('user_id', user.id)
                .order('checkin_date', { ascending: false })
                .limit(limit);

            if (error) fail(error.message, 500);

            const rows = checkins || [];
            if (!rows.length) return [];

            const { data: tasks, error: taskError } = await supabase
                .from('tasks')
                .select('checkin_id, completed')
                .in('checkin_id', rows.map(row => row.id));

            if (taskError) fail(taskError.message, 500);

            const counts = new Map();
            (tasks || []).forEach(task => {
                const entry = counts.get(task.checkin_id) || { total: 0, done: 0 };
                entry.total++;
                if (task.completed) entry.done++;
                counts.set(task.checkin_id, entry);
            });

            return rows.map(row => {
                const entry = counts.get(row.id) || { total: 0, done: 0 };
                return {
                    id: row.id,
                    checkin_date: row.checkin_date,
                    content: row.content,
                    created_at: row.created_at,
                    taskCount: entry.total,
                    completedTaskCount: entry.done
                };
            });
        });
    },

    profile: {
        async update({ nickname, avatar_emoji, bio, background_opacity }) {
            const user = await requireUser();

            const patch = {};
            if (nickname !== undefined) patch.nickname = nickname;
            if (avatar_emoji !== undefined) patch.avatar_emoji = avatar_emoji;
            if (bio !== undefined) patch.bio = bio;
            if (background_opacity !== undefined) {
                patch.background_opacity = Math.min(100, Math.max(0, Math.round(background_opacity)));
            }

            const { data, error } = await supabase
                .from('profiles')
                .update(patch)
                .eq('id', user.id)
                .select()
                .single();

            if (error) fail(error.message, 500);

            store.patchUser({
                nickname: data.nickname,
                avatar_emoji: data.avatar_emoji || '',
                avatar_url: data.avatar_url || '',
                background_url: data.background_url || '',
                background_mobile_url: data.background_mobile_url || '',
                background_opacity: data.background_opacity != null ? data.background_opacity : 100,
                bio: data.bio || ''
            });
            return { profile: data };
        },

        // 上传裁剪好的图片（kind: 'avatar' | 'background' | 'background-mobile'）
        async saveImage(kind, blob) {
            const user = await requireUser();
            const field = IMAGE_FIELDS[kind];
            if (!field) fail('未知的图片类型', 400);

            const url = await uploadImage(kind, blob);

            const { data, error } = await supabase
                .from('profiles')
                .update({ [field]: url })
                .eq('id', user.id)
                .select()
                .single();

            if (error) fail(error.message, 500);

            store.patchUser({
                avatar_url: data.avatar_url || '',
                background_url: data.background_url || '',
                background_mobile_url: data.background_mobile_url || ''
            });
            return { profile: data, url };
        },

        async clearImage(kind) {
            const user = await requireUser();
            const field = IMAGE_FIELDS[kind];
            if (!field) fail('未知的图片类型', 400);

            const { data, error } = await supabase
                .from('profiles')
                .update({ [field]: '' })
                .eq('id', user.id)
                .select()
                .single();

            if (error) fail(error.message, 500);

            // 顺手把桶里的文件删掉；删不掉也不影响资料本身
            Promise.resolve(supabase.storage.from(MEDIA_BUCKET).remove([`${user.id}/${kind}.jpg`]))
                .catch(() => {});

            store.patchUser({
                avatar_url: data.avatar_url || '',
                background_url: data.background_url || '',
                background_mobile_url: data.background_mobile_url || ''
            });
            return { profile: data };
        },

        async changePassword(password) {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) fail(translateAuthError(error), 400);
            return {};
        }
    },

    friends: {
        async addByEmail(email) {
            await requireUser();
            const { data, error } = await supabase.rpc('add_friend_by_email', { p_email: email });
            if (error) fail(translateAuthError(error), 400);
            return { friend: (data && data[0]) || null };
        },

        async remove(friendId) {
            const user = await requireUser();
            const [a, b] = orderedPair(user.id, friendId);

            const { error } = await supabase
                .from('friendships')
                .delete()
                .eq('user_a', a)
                .eq('user_b', b);

            if (error) fail(error.message, 500);
            return {};
        },

        // 好友列表 + 排行榜数据，一次请求拿到
        async overview() {
            await requireUser();
            const { data, error } = await supabase.rpc('friends_overview');
            if (error) fail(error.message, 500);
            return data || [];
        },

        // 好友动态流，一次请求拿到昵称/任务完成/点赞信息
        async feed(limit = 20) {
            await requireUser();
            const { data, error } = await supabase.rpc('friend_feed', { p_limit: limit });
            if (error) fail(error.message, 500);
            return data || [];
        }
    },

    likes: {
        async toggle(checkinId, liked) {
            const user = await requireUser();

            if (liked) {
                const { error } = await supabase
                    .from('checkin_likes')
                    .insert({ checkin_id: checkinId, user_id: user.id });
                // 23505 = 主键冲突，说明已经赞过了，按成功处理
                if (error && error.code !== '23505') fail(error.message, 500);
            } else {
                const { error } = await supabase
                    .from('checkin_likes')
                    .delete()
                    .eq('checkin_id', checkinId)
                    .eq('user_id', user.id);
                if (error) fail(error.message, 500);
            }

            return {};
        }
    },

    feedback: {
        // 我自己提交过的反馈，最新的在前
        async list(limit = 50) {
            const user = await requireUser();
            const { data, error } = await supabase
                .from('feedback')
                .select('id, content, contact, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) fail(error.message, 500);
            return (data || []).map(mapFeedback);
        },

        async create({ content, contact }) {
            const user = await requireUser();

            const text = String(content || '').trim();
            if (!text) fail('请先写点内容', 400);
            if (text.length > 2000) fail('内容太长了，请精简到 2000 字以内', 400);

            const { data, error } = await supabase
                .from('feedback')
                .insert({
                    user_id: user.id,
                    content: text,
                    contact: String(contact || '').trim().slice(0, 80)
                })
                .select('id, content, contact, created_at')
                .single();

            if (error) fail(error.message, 500);
            return { feedback: mapFeedback(data) };
        },

        async remove(id) {
            await requireUser();
            const { error } = await supabase.from('feedback').delete().eq('id', id);
            if (error) fail(error.message, 500);
            return {};
        }
    },

    tasks: {
        async add(content) {
            if (net.isOffline()) {
                const today = readToday();
                if (!today.checkin) fail('请先打卡', 400);

                const task = localTask(today.checkin.id, content.trim());
                today.tasks.push(task);
                writeToday(today);
                bumpTaskStats(1, 0);
                net.enqueue({
                    kind: 'task.add',
                    localId: task.id,
                    day: today.checkin.checkin_date,
                    content: task.content,
                    completed: false
                });

                return { task };
            }

            const user = await requireUser();
            const checkin = await getTodayCheckin(user.id);
            if (!checkin) fail('请先打卡', 400);

            const { data, error } = await supabase
                .from('tasks')
                .insert({ user_id: user.id, checkin_id: checkin.id, content: content.trim() })
                .select()
                .single();

            if (error) fail(error.message, 500);

            const task = mapTask(data);
            cacheTodayChange(today => today.tasks.push(task));
            return { task };
        },

        // 学习（背诵 / 考核 / 消灭错词）结束时自动记一条任务，直接算完成，
        // 这样完成率能反映学习量。今天还没打卡就返回 task: null，由调用方静默跳过
        async addStudyTask(content) {
            if (net.isOffline()) {
                const today = readToday();
                if (!today.checkin) return { task: null };

                const task = localTask(today.checkin.id, String(content || '').trim(), true);
                today.tasks.push(task);
                writeToday(today);
                bumpTaskStats(1, 1);
                net.enqueue({
                    kind: 'task.add',
                    localId: task.id,
                    day: today.checkin.checkin_date,
                    content: task.content,
                    completed: true
                });

                return { task };
            }

            const user = await requireUser();
            const checkin = await getTodayCheckin(user.id);
            if (!checkin) return { task: null };

            const { data, error } = await supabase
                .from('tasks')
                .insert({
                    user_id: user.id,
                    checkin_id: checkin.id,
                    content: String(content || '').trim(),
                    completed: true
                })
                .select()
                .single();

            if (error) fail(error.message, 500);

            const task = mapTask(data);
            cacheTodayChange(today => today.tasks.push(task));
            return { task };
        },

        async toggle(id, completed) {
            if (net.isOffline()) return offlineToggleTask(id, completed);

            await requireUser();
            const { data, error } = await supabase
                .from('tasks')
                .update({ completed })
                .eq('id', id)
                .select()
                .single();

            if (error) fail(error.message, 500);

            const task = mapTask(data);
            cacheTodayChange(today => {
                const item = today.tasks.find(entry => entry.id === task.id);
                if (item) item.completed = task.completed;
            });
            return { task };
        },

        async remove(id) {
            if (net.isOffline()) return offlineRemoveTask(id);

            await requireUser();
            const { error } = await supabase.from('tasks').delete().eq('id', id);
            if (error) fail(error.message, 500);

            cacheTodayChange(today => {
                today.tasks = today.tasks.filter(entry => entry.id !== id);
            });
            return {};
        }
    },

    wordbooks: {
        // 列表带上每个本子的单词数，避免为计数再发 N 次请求
        async list() {
            return net.cached('books', async () => {
                await requireUser();
                const { data, error } = await supabase
                    .from('wordbooks')
                    .select('id, name, created_at, words(count)')
                    .order('created_at', { ascending: false });

                if (error) fail(error.message, 500);
                return (data || []).map(mapBook);
            });
        },

        async detail(id) {
            return net.cached(`book:${id}`, () => fetchBookDetail(id));
        },

        // 字典里「加入生词本」用：单个词，先查重再加；离线时排队等联网补传
        async addWord(bookId, { term, meaning }) {
            const text = String(term || '').trim();
            const sense = String(meaning || '').trim();
            if (!text) fail('没有要加入的单词', 400);

            if (await bookHasWord(bookId, text)) return { added: false, duplicate: true };

            if (net.isOffline()) {
                net.enqueue({ kind: 'words.add', bookId, words: [{ term: text, meaning: sense }] });
                return { added: true, pending: true };
            }

            const user = await requireUser();
            const start = await nextWordPosition(bookId);
            const inserted = await insertWords(user.id, bookId, [{ term: text, meaning: sense }], start);
            if (!inserted.length) fail('加入失败，请稍后重试', 500);

            appendToBookCache(bookId, inserted[0]);
            return { added: true, word: inserted[0] };
        },

        async create({ name, words }) {
            const user = await requireUser();

            const { data: book, error } = await supabase
                .from('wordbooks')
                .insert({ user_id: user.id, name: name.trim() })
                .select()
                .single();

            if (error) fail(error.message, 500);

            const inserted = await insertWords(user.id, book.id, words, 0);
            return {
                book: { id: book.id, name: book.name, created_at: book.created_at, wordCount: inserted.length },
                words: inserted
            };
        },

        async addWords(bookId, words) {
            const user = await requireUser();
            const start = await nextWordPosition(bookId);
            return { words: await insertWords(user.id, bookId, words, start) };
        },

        async rename(id, name) {
            await requireUser();
            const { data, error } = await supabase
                .from('wordbooks')
                .update({ name: name.trim() })
                .eq('id', id)
                .select('id, name, created_at')
                .single();

            if (error) fail(error.message, 500);
            return { book: { id: data.id, name: data.name, created_at: data.created_at } };
        },

        async remove(id) {
            await requireUser();
            const { error } = await supabase.from('wordbooks').delete().eq('id', id);
            if (error) fail(error.message, 500);
            return {};
        },

        async removeWord(id) {
            await requireUser();
            const { error } = await supabase.from('words').delete().eq('id', id);
            if (error) fail(error.message, 500);
            return {};
        },

        // 开始一次背诵 / 考核，返回会话 id（前端在第一次作答时才调用）。
        // 离线时先返回一个本地 runId，同步时再真正建会话，逐词作答挂在同一条队列里
        async startSession({ mode, bookId, bookName, total }) {
            if (net.isOffline()) {
                const runId = net.localId('run');
                net.enqueue({
                    kind: 'study',
                    runId,
                    mode,
                    bookId: bookId || null,
                    bookName: bookName || '',
                    total: total || 0,
                    reviews: []
                });
                return runId;
            }

            await requireUser();
            const { data, error } = await supabase.rpc('start_study_session', {
                p_mode: mode,
                p_book_id: bookId || null,
                p_book_name: bookName || '',
                p_total: total || 0
            });

            if (error) fail(error.message, 500);
            return data;
        },

        // 背诵/考核一次作答：服务端同时更新单词进度、写明细、累加会话统计。
        // 返回更新后的单词进度，调用方用它覆盖本地的乐观更新。
        // 离线时只把作答记进队列，返回 null —— 界面本来就已经做过乐观更新，不用再覆盖
        async recordReview(sessionId, wordId, result) {
            if (net.isOffline()) {
                const entry = net.pending().find(op => op.kind === 'study' && op.runId === sessionId);
                if (entry) {
                    net.enqueue({
                        kind: 'study',
                        runId: sessionId,
                        reviews: [{ wordId, result, at: Date.now() }]
                    });
                }
                return null;
            }

            await requireUser();
            const { data, error } = await supabase.rpc('record_word_review', {
                p_session_id: sessionId || null,
                p_word_id: wordId,
                p_result: result
            });

            if (error) fail(error.message, 500);
            return (data && data[0]) || null;
        },

        // 学习记录：最近的背诵 / 考核会话，按时间倒序
        async records(limit = 120) {
            return net.cached('records', async () => {
                await requireUser();
                const { data, error } = await supabase
                    .from('study_sessions')
                    .select('id, book_id, book_name, mode, total, known, vague, again, correct, wrong, created_at')
                    .order('created_at', { ascending: false })
                    .limit(limit);

                if (error) fail(error.message, 500);
                return (data || []).map(mapSession);
            });
        },

        // 单条学习记录；详情页直接按 id 取，不依赖列表的条数上限
        async session(id) {
            return net.cached(`session:${id}`, async () => {
                await requireUser();
                const { data, error } = await supabase
                    .from('study_sessions')
                    .select('id, book_id, book_name, mode, total, known, vague, again, correct, wrong, created_at')
                    .eq('id', id)
                    .maybeSingle();

                if (error) fail(error.message, 500);
                return data ? mapSession(data) : null;
            });
        },

        // 单次会话的逐词明细，展开记录时才拉取；整本背诵可能上千条，分页取全
        async sessionLogs(sessionId) {
            return net.cached(`logs:${sessionId}`, async () => {
                await requireUser();
                const all = [];

                for (let from = 0; ; from += LOGS_PAGE_SIZE) {
                    const { data, error } = await supabase
                        .from('study_logs')
                        .select('id, word_id, term, meaning, result, created_at')
                        .eq('session_id', sessionId)
                        .order('created_at', { ascending: true })
                        .order('id', { ascending: true })
                        .range(from, from + LOGS_PAGE_SIZE - 1);

                    if (error) fail(error.message, 500);

                    const rows = data || [];
                    all.push(...rows);
                    if (rows.length < LOGS_PAGE_SIZE) break;
                }

                return all;
            });
        },

        // 导出用：这个用户所有答错过的词（跨单词本），错得多的排前面
        async wrongWords() {
            const user = await requireUser();
            const all = [];

            for (let from = 0; ; from += WORDS_PAGE_SIZE) {
                const { data, error } = await supabase
                    .from('words')
                    .select('id, book_id, term, meaning, mastery, review_count, correct_count, wrong_count, last_result, last_reviewed_at')
                    .eq('user_id', user.id)
                    .gt('wrong_count', 0)
                    .order('wrong_count', { ascending: false })
                    // 错误次数相同的按 id 兜底，分页才不会漏行或重复
                    .order('id', { ascending: true })
                    .range(from, from + WORDS_PAGE_SIZE - 1);

                if (error) fail(error.message, 500);

                const rows = data || [];
                all.push(...rows);
                if (rows.length < WORDS_PAGE_SIZE) break;
            }

            return all.map(mapWord);
        },

        // 清空一本单词本的背诵进度
        async resetProgress(bookId) {
            await requireUser();

            // 一次 update 同样受 1000 行上限影响，按 book_id 分批清
            const ids = await fetchAllWords(bookId);
            const CHUNK = 500;

            for (let i = 0; i < ids.length; i += CHUNK) {
                const slice = ids.slice(i, i + CHUNK).map(word => word.id);
                const { error } = await supabase
                    .from('words')
                    .update({
                        mastery: 0,
                        review_count: 0,
                        correct_count: 0,
                        wrong_count: 0,
                        last_result: null,
                        last_reviewed_at: null
                    })
                    .in('id', slice);

                if (error) fail(error.message, 500);
            }

            return {};
        }
    },

    // 词汇量测试：每次估算结果都在云端留一条，便于看词汇量随时间的变化
    vocab: {
        async save({ estimate, low, high, total, known, durationMs, bands }) {
            if (net.isOffline()) {
                // 估算完全在本地算出来，先写进本地历史，联网后再补传
                const test = {
                    id: net.localId('vocab'),
                    estimate,
                    low,
                    high,
                    total,
                    known,
                    durationMs: durationMs || 0,
                    bands: bands || [],
                    createdAt: new Date().toISOString()
                };

                const history = net.cacheValue('vocabHistory');
                const list = Array.isArray(history) ? history : [];
                list.unshift(test);
                net.setCacheValue('vocabHistory', list);

                net.enqueue({ kind: 'vocab', estimate, low, high, total, known, durationMs, bands });
                return test;
            }

            const user = await requireUser();
            const { data, error } = await supabase
                .from('vocab_tests')
                .insert({
                    user_id: user.id,
                    estimate,
                    low,
                    high,
                    total,
                    known,
                    duration_ms: durationMs || 0,
                    bands: bands || []
                })
                .select()
                .single();

            if (error) fail(error.message, 500);
            return mapVocabTest(data);
        },

        async list(limit = 50) {
            return net.cached('vocabHistory', async () => {
                await requireUser();
                const { data, error } = await supabase
                    .from('vocab_tests')
                    .select('id, estimate, low, high, total, known, duration_ms, bands, created_at')
                    .order('created_at', { ascending: false })
                    .limit(limit);

                if (error) fail(error.message, 500);
                return (data || []).map(mapVocabTest);
            });
        },

        async remove(id) {
            if (net.isOffline()) {
                // 还没同步的记录直接从队列里撤掉，其余的等联网再删
                if (SERVER_ID.test(String(id || ''))) {
                    net.enqueue({ kind: 'vocab.remove', id });
                }

                const history = net.cacheValue('vocabHistory');
                if (Array.isArray(history)) {
                    net.setCacheValue('vocabHistory', history.filter(item => item.id !== id));
                }
                return {};
            }

            await requireUser();
            const { error } = await supabase.from('vocab_tests').delete().eq('id', id);
            if (error) fail(error.message, 500);
            return {};
        }
    }
};

// 这几类必须联网：离线时给一句能看懂的提示，而不是让用户撞上 Failed to fetch
const ONLINE_ONLY = {
    'profile.update': '修改个人资料',
    'profile.saveImage': '上传图片',
    'profile.clearImage': '移除图片',
    'profile.changePassword': '修改密码',
    'friends.addByEmail': '添加好友',
    'friends.remove': '删除好友',
    'likes.toggle': '点赞',
    'feedback.create': '提交反馈',
    'feedback.remove': '删除反馈',
    'wordbooks.create': '新建单词本',
    'wordbooks.addWords': '追加单词',
    'wordbooks.rename': '重命名单词本',
    'wordbooks.remove': '删除单词本',
    'wordbooks.removeWord': '删除单词',
    'wordbooks.resetProgress': '清空背诵进度'
};

for (const [name, label] of Object.entries(ONLINE_ONLY)) {
    const [group, method] = name.split('.');
    const target = api[group];
    const original = target[method];

    target[method] = (...args) => {
        if (net.isOffline()) offlineUnsupported(label);
        return original.apply(target, args);
    };
}

// Supabase 默认单次最多返回 1000 行（Dashboard → Integrations → Data API → Max rows），
// 单词本常有上千词，必须分页取，否则会被静默截断
const WORDS_PAGE_SIZE = 1000;
const WORDS_INSERT_CHUNK = 500;
const LOGS_PAGE_SIZE = 1000;

async function fetchAllWords(bookId) {
    const all = [];

    for (let from = 0; ; from += WORDS_PAGE_SIZE) {
        const { data, error } = await supabase
            .from('words')
            .select('*')
            .eq('book_id', bookId)
            // 按导入时的位置排；position 在旧数据里可能重复，再按 id 兜底，分页才不会漏行或重复
            .order('position', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + WORDS_PAGE_SIZE - 1);

        if (error) fail(error.message, 500);

        const rows = data || [];
        all.push(...rows);
        if (rows.length < WORDS_PAGE_SIZE) break;
    }

    return all.map(mapWord);
}

async function insertWords(userId, bookId, words, startPosition = 0) {
    const rows = (words || [])
        .filter(word => word && word.term)
        .map((word, index) => ({
            user_id: userId,
            book_id: bookId,
            term: String(word.term).trim(),
            meaning: String(word.meaning || '').trim(),
            position: startPosition + index
        }));

    const inserted = [];

    // 一次插入上千行容易超时，分批写
    for (let i = 0; i < rows.length; i += WORDS_INSERT_CHUNK) {
        const { data, error } = await supabase
            .from('words')
            .insert(rows.slice(i, i + WORDS_INSERT_CHUNK))
            .select();

        if (error) fail(error.message, 500);
        inserted.push(...(data || []));
    }

    return inserted.map(mapWord);
}

// 追加时接着本子里最大的 position 往后排；即使删过词也用 max + 1，避免和已有位置重叠
async function nextWordPosition(bookId) {
    const { data, error } = await supabase
        .from('words')
        .select('position')
        .eq('book_id', bookId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) fail(error.message, 500);
    return data ? Number(data.position) + 1 : 0;
}
