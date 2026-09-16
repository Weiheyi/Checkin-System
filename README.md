# 学习打卡系统

一个纯静态的学习打卡网站：每天打卡、记录任务、统计连续天数与完成率。
托管在 **GitHub Pages**，账号与数据由 **Supabase** 提供。

线上地址：https://Weiheyi.github.io/Checkin-System/

## 功能

- 邮箱 + 密码注册登录
- 忘记密码：通过邮件重置链接设置新密码
- 人机验证：登录、注册、找回密码均受 Cloudflare Turnstile 保护
- 每日打卡（每人每天一次，重复打卡会被拦截）
- 任务管理：添加、勾选完成/取消、删除
- 学习统计：连续天数、打卡天数、完成任务数、完成率
- 打卡历史：最近记录与完成进度

## 技术栈

- 前端：原生 HTML / CSS / ES Modules，无构建步骤
- 账号：Supabase Auth
- 数据：Supabase Postgres，启用行级安全（RLS），每个用户只能读写自己的数据
- 托管：GitHub Pages（通过 GitHub Actions 发布 `public/`）

## 目录结构

```
.
├── .github/workflows/deploy.yml   # 自动部署到 GitHub Pages
├── supabase/schema.sql            # 数据库建表脚本（在 Supabase 执行一次）
└── public/                        #  ← 只有这里会被发布
    ├── index.html                 # 登录 / 注册
    ├── dashboard.html             # 打卡主页
    ├── css/style.css
    ├── vendor/supabase.js         # 官方自包含的 supabase-js 构建
    └── js/
        ├── config.js              # ← Supabase 地址与 anon key 填这里
        ├── supabase.js            # 客户端初始化
        ├── api.js                 # 数据层（唯一与后端交互的地方）
        ├── store.js               # 登录态缓存
        ├── ui.js                  # toast / 工具函数
        ├── auth.js                # 登录注册页逻辑
        └── dashboard.js           # 主页逻辑
```

## 配置（首次使用）

### 1. 在 Supabase 建项目

1. 到 https://supabase.com 注册并新建一个免费 Project
2. 打开 **SQL Editor**，把 `supabase/schema.sql` 的内容整段粘贴执行

### 2. 关闭邮箱验证

**Authentication → Sign In / Providers → Email** → 关闭 **Confirm email**。

关闭后注册即可直接登录，无需去邮箱确认。

### 3. 配置站点地址（找回密码需要）

**Authentication → URL Configuration** → 把 **Site URL** 改成线上地址：

```
https://weiheyi.github.io/Checkin-System/
```

> 用户点击找回密码邮件里的链接后会被重定向到这个地址。
> 若这里仍是 `http://localhost:3000`，线上点击链接会跳到错误的地方。

### 4. 配置人机验证（Cloudflare Turnstile）

1. 到 https://dash.cloudflare.com/?to=/:account/turnstile 新建 widget，
   Hostnames 填入 `weiheyi.github.io` 与 `localhost`
2. 复制 **Site Key**，填进 `public/js/config.js` 的 `TURNSTILE_SITE_KEY`
3. 复制 **Secret Key**，填到 Supabase 的
   **Authentication → Settings → Bot and Abuse Protection → Enable CAPTCHA protection**，
   供应商选 Turnstile，粘贴 Secret Key 后保存

> 开启后 Supabase 的**所有** Auth 请求（包括登录）都必须携带人机验证 token，
> 因此登录表单也会出现验证组件，这是 Supabase 的设计。

### 5. 填写前端配置

**Project Settings → API** 里复制两样东西，连同 Turnstile 的 Site Key 一起填进 `public/js/config.js`：

```js
export const SUPABASE_URL = 'https://xxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
export const TURNSTILE_SITE_KEY = '你的 Turnstile Site Key';
```

> `anon key` 与 Turnstile `Site Key` 设计上都是可以公开的，
> 安全性分别由数据库的 RLS 策略和 Supabase 侧的 Secret Key 保证。
> 请务必确认 `schema.sql` 里的 RLS 语句全部执行成功。

### 6. （可选）配置自定义 SMTP

**默认不需要配置。** Supabase 自带的邮件服务就能发出找回密码邮件，但有两个限制：

- 只能发送到**项目团队成员**的邮箱（也就是你注册 Supabase 时用的那个邮箱）
- 每小时最多 2 封

只有当你想让**其他邮箱注册的账号**也能找回密码时，才需要配置自定义 SMTP
（推荐 Brevo，免费 300 封/天，无需自有域名）：

```
https://supabase.com/dashboard/project/_/auth/smtp
```

## 本地预览

ES Modules 需要通过 http 访问，不能直接双击打开 html：

```
npx serve public
```

然后打开提示的地址（默认 http://localhost:3000）。

## 部署

推送到 `main` 分支后，GitHub Actions 会自动把 `public/` 发布到 GitHub Pages。

首次需要手动开启一次：仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 注意事项

- Supabase 免费版项目闲置约一周会被暂停，需要到控制台手动唤醒
- GitHub Pages 对公开仓库免费；仓库若转为私有，Pages 将不可用
