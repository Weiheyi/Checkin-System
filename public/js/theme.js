import { THEME_KEY } from './config.js';

const MEDIA = window.matchMedia('(prefers-color-scheme: dark)');
const MODES = ['light', 'dark', 'system'];

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

// 选择「跟随系统」时，系统主题变化要即时生效
MEDIA.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
});

applyTheme();
