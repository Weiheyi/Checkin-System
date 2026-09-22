// Supabase 项目配置
// 在 Supabase 控制台 → Project Settings → API 里找到这两项
// 注意：anon key 设计上就是公开的，数据安全由数据库的 RLS 策略保证
export const SUPABASE_URL = 'https://dhemqusvocjcbfvopwcm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZW1xdXN2b2NqY2Jmdm9wd2NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MjY1MjYsImV4cCI6MjEwNTEwMjUyNn0.ruM2PUFsxYu_oRMqgcekzYbr2FYcGnvSqTgQNUEDm9I';

export const PAGES = {
    login: 'index.html',
    dashboard: 'dashboard.html',
    tools: 'tools.html',
    record: 'record.html',
    friends: 'friends.html',
    community: 'community.html',
    post: 'post.html',
    profile: 'profile.html',
    guide: 'guide.html'
};

// 主题偏好的 localStorage key；页面 <head> 里的内联脚本也用同一个字符串，改动时需同步
export const THEME_KEY = 'checkin_theme';

// 界面样式（配色）与界面透明度的本地 key；同样要和 <head> 里的内联脚本保持一致
export const ACCENT_KEY = 'checkin_accent';
export const UI_ALPHA_KEY = 'checkin_ui_alpha';

// 可选的「界面样式」：只换主色与渐变，浅色 / 深色各自适配
export const ACCENTS = [
    { key: 'default', label: '默认' },
    { key: 'sunset', label: '晚霞' },
    { key: 'ocean', label: '大海' },
    { key: 'forest', label: '森林' },
    { key: 'sakura', label: '樱粉' }
];

// 个人中心可选的预设头像
export const AVATAR_CHOICES = ['📚', '🔥', '🌟', '🚀', '🎯', '🌱', '🧠', '💪', '☕', '🎨', '🎧', '🐱'];

// 当天学习（背诵 + 考核 + 灭错）累计复习到这么多个「不同单词」就自动打卡。
// 与服务端 auto_checkin_if_learned 的默认阈值保持一致（前端会把值传过去）
export const AUTO_CHECKIN_WORDS = 5;

// 错题本的默认题型：第一次进入错题本时拷进用户自己的题型表，之后可自由增删改。
// 顺序即展示顺序（sort）。
export const MISTAKE_DEFAULT_CATEGORIES = [
    'Craft and Structure',
    'Information and Ideas',
    'Expression of Ideas',
    'Standard English Conventions',
    'Algebra',
    'Advanced Math',
    'Problem-Solving and Data Analysis',
    'Geometry and Trigonometry'
];
