const TOKEN_KEY = 'checkin_token';
const USER_KEY = 'checkin_user';

function readUser() {
    try {
        return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
        return null;
    }
}

export const store = {
    getToken() {
        return localStorage.getItem(TOKEN_KEY);
    },
    setToken(token) {
        localStorage.setItem(TOKEN_KEY, token);
    },
    getUser: readUser,
    setUser(user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    isLoggedIn() {
        return !!localStorage.getItem(TOKEN_KEY);
    },
    clear() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }
};
