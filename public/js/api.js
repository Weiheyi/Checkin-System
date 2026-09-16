import { API_BASE, PAGES } from './config.js';
import { store } from './store.js';

function goToLogin() {
    if (!location.pathname.endsWith(PAGES.login)) {
        location.replace(PAGES.login);
    }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && store.getToken()) {
        headers['Authorization'] = `Bearer ${store.getToken()}`;
    }

    const res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }

    if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
            store.clear();
            goToLogin();
        }
        const error = new Error((data && data.error) || `请求失败 (${res.status})`);
        error.status = res.status;
        throw error;
    }

    return data;
}

export const api = {
    register: payload => request('/register', { method: 'POST', body: payload, auth: false }),
    login: payload => request('/login', { method: 'POST', body: payload, auth: false }),
    me: () => request('/me'),
    checkIn: (content = '') => request('/checkin', { method: 'POST', body: { content } }),
    getToday: () => request('/checkin/today'),
    stats: () => request('/stats'),
    history: (limit = 30) => request(`/history?limit=${limit}`),
    tasks: {
        add: content => request('/tasks', { method: 'POST', body: { content } }),
        toggle: (id, completed) => request(`/tasks/${id}`, { method: 'PUT', body: { completed } }),
        remove: id => request(`/tasks/${id}`, { method: 'DELETE' })
    }
};
