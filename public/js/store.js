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
    isLoggedIn() {
        return !!readUser();
    },
    clear() {
        localStorage.removeItem(USER_KEY);
    }
};
