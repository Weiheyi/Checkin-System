import { THEME_KEY, ACCENT_KEY, UI_ALPHA_KEY, ACCENTS } from './config.js';

const MEDIA = window.matchMedia('(prefers-color-scheme: dark)');
const MODES = ['light', 'dark', 'system'];
const ACCENT_KEYS = ACCENTS.map(item => item.key);

// 界面透明度：低于 30% 字就看不清了，所以夹在 30~100
export const UI_ALPHA_MIN = 30;
export const UI_ALPHA_MAX = 100;
const UI_ALPHA_DEFAULT = 100;

export function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    return MODES.includes(saved) ? saved : 'system';
}

// 把「偏好」换算成实际生效的主题
export function resolvedTheme(theme = getTheme()) {
    if (theme === 'system') return MEDIA.matches ? 'dark' : 'light';
    return theme;
}

export function applyTheme(theme = getTheme()) {
    document.documentElement.dataset.theme = resolvedTheme(theme);
    // 通知界面各处（顶部栏图标、设置里的分段控件）同步刷新
    window.dispatchEvent(new CustomEvent('themechange', {
        detail: { theme: getTheme(), resolved: resolvedTheme(theme) }
    }));
}

export function setTheme(theme) {
    if (!MODES.includes(theme)) return;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
}

/* ---------------- 界面样式（配色） ---------------- */

export function getAccent() {
    const saved = localStorage.getItem(ACCENT_KEY);
    return ACCENT_KEYS.includes(saved) ? saved : 'default';
}

export function applyAccent(accent = getAccent()) {
    const root = document.documentElement;
    if (accent === 'default') delete root.dataset.accent;
    else root.dataset.accent = accent;

    window.dispatchEvent(new CustomEvent('accentchange', { detail: { accent } }));
}

export function setAccent(accent) {
    if (!ACCENT_KEYS.includes(accent)) return;
    localStorage.setItem(ACCENT_KEY, accent);
    applyAccent(accent);
}

/* ---------------- 界面透明度 ---------------- */

// 面板有多不透明：100% 完全不透明，调低后自定义背景会透出来
export function getUiAlpha() {
    const saved = Number(localStorage.getItem(UI_ALPHA_KEY));
    if (!Number.isFinite(saved) || saved <= 0) return UI_ALPHA_DEFAULT;
    return Math.min(UI_ALPHA_MAX, Math.max(UI_ALPHA_MIN, saved));
}

export function applyUiAlpha(value = getUiAlpha()) {
    document.documentElement.style.setProperty('--ui-alpha', `${value}%`);
    window.dispatchEvent(new CustomEvent('uialphachange', { detail: { value } }));
}

export function setUiAlpha(value) {
    const clamped = Math.min(UI_ALPHA_MAX, Math.max(UI_ALPHA_MIN, Math.round(value)));
    localStorage.setItem(UI_ALPHA_KEY, String(clamped));
    applyUiAlpha(clamped);
    return clamped;
}

// 选择「跟随系统」时，系统主题变化要即时生效
MEDIA.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
});

applyTheme();
applyAccent();
applyUiAlpha();
