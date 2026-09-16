// Supabase 项目配置
// 在 Supabase 控制台 → Project Settings → API 里找到这两项
// 注意：anon key 设计上就是公开的，数据安全由数据库的 RLS 策略保证
export const SUPABASE_URL = 'https://dhemqusvocjcbfvopwcm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZW1xdXN2b2NqY2Jmdm9wd2NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MjY1MjYsImV4cCI6MjEwNTEwMjUyNn0.ruM2PUFsxYu_oRMqgcekzYbr2FYcGnvSqTgQNUEDm9I';

// Cloudflare Turnstile 的 Site Key（公开密钥，可安全提交到仓库）
// 在 https://dash.cloudflare.com/?to=/:account/turnstile 新建 widget 后获得
// 留空则不加载人机验证组件——仅用于你还没在 Supabase 开启 CAPTCHA 时的过渡
export const TURNSTILE_SITE_KEY = '0x4AAAAAAE4HPhBov0KZAwSp';

export const PAGES = {
    login: 'index.html',
    dashboard: 'dashboard.html'
};
