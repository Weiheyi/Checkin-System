const USER_KEY = 'checkin_user';

function readUser() {
    try {
        return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
        return null;
    }
}

// 仅作界面用的登录态缓存；真正的会话由 Supabase SDK 自行持久化
export const store = {
    getUser: readUser,
    setUser(user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    // 改了昵称/头像后就地更新缓存，免得为一次修改再请求一遍资料
    patchUser(partial) {
        const current = readUser();
        if (current) store.setUser({ ...current, ...partial });
    },
    isLoggedIn() {
        return !!readUser();
    },
    clear() {
        localStorage.removeItem(USER_KEY);
    }
};
