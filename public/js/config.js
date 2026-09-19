// Supabase 项目配置
// 在 Supabase 控制台 → Project Settings → API 里找到这两项
// 注意：anon key 设计上就是公开的，数据安全由数据库的 RLS 策略保证
export const SUPABASE_URL = 'https://dhemqusvocjcbfvopwcm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZW1xdXN2b2NqY2Jmdm9wd2NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MjY1MjYsImV4cCI6MjEwNTEwMjUyNn0.ruM2PUFsxYu_oRMqgcekzYbr2FYcGnvSqTgQNUEDm9I';

export const PAGES = {
    login: 'index.html',
    dashboard: 'dashboard.html',
    tools: 'tools.html',
    friends: 'friends.html',
    profile: 'profile.html',
    guide: 'guide.html'
};

// 主题偏好的 localStorage key；页面 <head> 里的内联脚本也用同一个字符串，改动时需同步
export const THEME_KEY = 'checkin_theme';

// 个人中心可选的预设头像
export const AVATAR_CHOICES = ['📚', '🔥', '🌟', '🚀', '🎯', '🌱', '🧠', '💪', '☕', '🎨', '🎧', '🐱'];
