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
        .select('nickname')
        .eq('id', user.id)
        .maybeSingle();

    return {
        id: user.id,
        email: user.email,
        nickname: (data && data.nickname) || (user.email || '').split('@')[0] || '用户'
    };
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

// 连续天数只取决于最近这段日子，取最近 STREAK_WINDOW 天即可，
// 免得打卡记录越积越多时把全部日期都拉回前端
const STREAK_WINDOW = 400;

function computeStreak(dates) {
    const set = new Set(dates);
    const cursor = new Date();
    if (!set.has(todayStr(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
    }
    let streak = 0;
    while (set.has(todayStr(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
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
    return message;
}

export const api = {
    async register({ email, nickname, password, captchaToken }) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { nickname: nickname || email.split('@')[0] },
                captchaToken
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

    async login({ email, password, captchaToken }) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
            options: { captchaToken }
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

    async stats() {
        const user = await requireUser();

        const [days, allTasks, doneTasks, dates] = await Promise.all([
            supabase.from('checkins').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
            supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
            supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('completed', true),
            supabase.from('checkins')
                .select('checkin_date')
                .eq('user_id', user.id)
                .order('checkin_date', { ascending: false })
                .limit(STREAK_WINDOW)
        ]);

        const totalTasks = allTasks.count || 0;
        const completedTasks = doneTasks.count || 0;

        return {
            totalDays: days.count || 0,
            totalTasks,
            completedTasks,
            completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
            streak: computeStreak((dates.data || []).map(row => row.checkin_date))
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
    }
};
