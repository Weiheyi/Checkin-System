import { supabase } from './supabase.js';
import { PAGES } from './config.js';
import { store } from './store.js';

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

        return { checkin: mapCheckin(data) };
    },

    async getToday() {
        const user = await requireUser();
        const checkin = await getTodayCheckin(user.id);
        if (!checkin) return { checked: false, checkin: null, tasks: [] };

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
    },

    // 统计全部在数据库一次算完，替代原来的 4 次 count 请求
    async stats() {
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
    },

    async history(limit = 30) {
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
            const user = await requireUser();
            const checkin = await getTodayCheckin(user.id);
            if (!checkin) fail('请先打卡', 400);

            const { data, error } = await supabase
                .from('tasks')
                .insert({ user_id: user.id, checkin_id: checkin.id, content: content.trim() })
                .select()
                .single();

            if (error) fail(error.message, 500);
            return { task: mapTask(data) };
        },

        // 学习（背诵 / 考核 / 消灭错词）结束时自动记一条任务，直接算完成，
        // 这样完成率能反映学习量。今天还没打卡就返回 task: null，由调用方静默跳过
        async addStudyTask(content) {
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
            return { task: mapTask(data) };
        },

        async toggle(id, completed) {
            await requireUser();
            const { data, error } = await supabase
                .from('tasks')
                .update({ completed })
                .eq('id', id)
                .select()
                .single();

            if (error) fail(error.message, 500);
            return { task: mapTask(data) };
        },

        async remove(id) {
            await requireUser();
            const { error } = await supabase.from('tasks').delete().eq('id', id);
            if (error) fail(error.message, 500);
            return {};
        }
    },

    wordbooks: {
        // 列表带上每个本子的单词数，避免为计数再发 N 次请求
        async list() {
            await requireUser();
            const { data, error } = await supabase
                .from('wordbooks')
                .select('id, name, created_at, words(count)')
                .order('created_at', { ascending: false });

            if (error) fail(error.message, 500);
            return (data || []).map(mapBook);
        },

        async detail(id) {
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

        // 开始一次背诵 / 考核，返回会话 id（前端在第一次作答时才调用）
        async startSession({ mode, bookId, bookName, total }) {
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
        async recordReview(sessionId, wordId, result) {
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
            await requireUser();
            const { data, error } = await supabase
                .from('study_sessions')
                .select('id, book_id, book_name, mode, total, known, vague, again, correct, wrong, created_at')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) fail(error.message, 500);
            return (data || []).map(mapSession);
        },

        // 单条学习记录；详情页直接按 id 取，不依赖列表的条数上限
        async session(id) {
            await requireUser();
            const { data, error } = await supabase
                .from('study_sessions')
                .select('id, book_id, book_name, mode, total, known, vague, again, correct, wrong, created_at')
                .eq('id', id)
                .maybeSingle();

            if (error) fail(error.message, 500);
            return data ? mapSession(data) : null;
        },

        // 单次会话的逐词明细，展开记录时才拉取；整本背诵可能上千条，分页取全
        async sessionLogs(sessionId) {
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
            await requireUser();
            const { data, error } = await supabase
                .from('vocab_tests')
                .select('id, estimate, low, high, total, known, duration_ms, bands, created_at')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) fail(error.message, 500);
            return (data || []).map(mapVocabTest);
        },

        async remove(id) {
            await requireUser();
            const { error } = await supabase.from('vocab_tests').delete().eq('id', id);
            if (error) fail(error.message, 500);
            return {};
        }
    }
};

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
