# 学习打卡系统

一个纯静态的学习打卡网站：每天打卡、记录任务、统计连续天数与完成率。
托管在 **GitHub Pages**，账号与数据由 **Supabase** 提供。

线上地址：https://Weiheyi.github.io/Checkin-System/

## 功能

- 邮箱 + 密码注册登录（不依赖任何邮件流程，注册后直接可用）
- 人机验证：登录、注册均需先通过「四则运算」快速验证，并叠加 Cloudflare Turnstile
- 每日打卡（每人每天一次，重复打卡会被拦截）
- 任务管理：添加、勾选完成/取消、删除
- 学习统计：连续天数、打卡天数、完成任务数、完成率
- 打卡历史：最近记录与完成进度
- 好友：邮箱精确添加 / 删除、好友打卡动态流、排行榜 PK、点赞鼓励
- 个人中心：头像 / 昵称 / 签名、个人数据总览、修改密码
- 学习工具：计时器、倒计时（到点响铃）、背单词（粘贴单词表自动识别 → 背诵 → 考核）
- 界面：暗色模式（浅色 / 深色 / 跟随系统）、移动端底部导航

## 技术栈

- 前端：原生 HTML / CSS / ES Modules，无构建步骤
- 账号：Supabase Auth
- 数据：Supabase Postgres，启用行级安全（RLS），本人可读写、好友可读
- 托管：GitHub Pages（通过 GitHub Actions 发布 `public/`）

## 目录结构

```
.
├── .github/workflows/deploy.yml   # 自动部署到 GitHub Pages
├── supabase/schema.sql            # 数据库建表脚本（在 Supabase 执行一次）
└── public/                        #  ← 只有这里会被发布
    ├── index.html                 # 登录 / 注册
    ├── dashboard.html             # 打卡主页
    ├── tools.html                 # 学习工具（计时器 / 倒计时 / 背单词）
    ├── friends.html               # 好友（动态 / 排行榜 / 好友列表）
    ├── profile.html               # 个人中心
    ├── css/style.css
    ├── vendor/supabase.js         # 官方自包含的 supabase-js 构建
    └── js/
        ├── config.js              # ← Supabase 地址与 anon key 填这里
        ├── supabase.js            # 客户端初始化
        ├── api.js                 # 数据层（唯一与后端交互的地方）
        ├── store.js               # 登录态缓存
        ├── theme.js               # 主题（浅色 / 深色 / 跟随系统）
        ├── shell.js               # 公共外壳：顶部栏 + 底部导航 + 登录守卫
        ├── ui.js                  # toast / 骨架屏 / 确认弹窗 / 工具函数
        ├── math-captcha.js        # 四则运算人机验证（前端辅助校验）
        ├── auth.js                # 登录注册页逻辑
        ├── dashboard.js           # 主页逻辑
        ├── tools.js               # 工具页逻辑（含单词表识别解析）
        ├── friends.js             # 好友页逻辑
        └── profile.js             # 个人中心逻辑
```

## 配置（首次使用）

### 1. 在 Supabase 建项目

1. 到 https://supabase.com 注册并新建一个免费 Project
2. 打开 **SQL Editor**，把 `supabase/schema.sql` 的内容整段粘贴执行

> `schema.sql` 已包含好友、点赞、个人中心、单词本所需的全部表、RLS 策略与 RPC 函数，
> 且可重复执行。**如果项目是以前建的**，把最新的 `schema.sql` 再整段跑一次即可补上这些对象。

### 2. 关闭邮箱确认（必须）

**Authentication → Sign In / Providers → Email** → 关闭 **Confirm email**。

这一步不能跳过：开启时 `signUp` 不会返回会话，注册后无法自动登录（页面会明确提示你回到这里关闭它）。
关闭之后整个站点不再有任何邮件依赖，也不需要配置 SMTP。

### 3. 配置人机验证（Cloudflare Turnstile）

1. 到 https://dash.cloudflare.com/?to=/:account/turnstile 新建 widget，
   Hostnames 填入 `weiheyi.github.io` 与 `localhost`
2. 复制 **Site Key**，填进 `public/js/config.js` 的 `TURNSTILE_SITE_KEY`
3. 复制 **Secret Key**，填到 Supabase 的
   **Authentication → Settings → Bot and Abuse Protection → Enable CAPTCHA protection**，
   供应商选 Turnstile，粘贴 Secret Key 后保存

> 开启后 Supabase 的**所有** Auth 请求（包括登录）都必须携带人机验证 token，
> 因此登录表单也会出现验证组件，这是 Supabase 的设计。
>
> 还没配好 Secret Key 时，把 `TURNSTILE_SITE_KEY` 留空即可完全不加载该组件，
> 此时只保留「四则运算」这一层验证。

### 4. 填写前端配置

**Project Settings → API** 里复制两样东西，连同 Turnstile 的 Site Key 一起填进 `public/js/config.js`：

```js
export const SUPABASE_URL = 'https://xxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
export const TURNSTILE_SITE_KEY = '你的 Turnstile Site Key';
```

> `anon key` 与 Turnstile `Site Key` 设计上都是可以公开的，
> 安全性分别由数据库的 RLS 策略和 Supabase 侧的 Secret Key 保证。
> 请务必确认 `schema.sql` 里的 RLS 语句全部执行成功。

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
- 好友通过**邮箱精确匹配**添加，因此登录用户能判断某个邮箱是否已注册（这是该方式的固有代价）；
  若在意隐私，可把 `add_friend_by_email` 换成「邀请码」方案
- 好友之间的打卡与任务在数据库层面互相可读（RLS 的 `friends read` 策略），用于动态流与排行榜

### 关于「四则运算」验证

它由纯前端生成与校验，**只能挡住最明显的脚本提交，不是真正的安全边界**——
攻击者绕过前端直接调用 Supabase API 即可跳过。

真正的防护来自 Cloudflare Turnstile（Supabase 服务端校验）和数据库的 RLS 策略。
四则运算的作用是给正常用户一个低成本、无需外部依赖的验证步骤，
也能在 Turnstile 加载失败时作为兜底提示。

### 关于「背单词」的单词表识别

在工具页「背单词」里新建单词本时，直接粘贴单词表即可，每行一个单词。
解析完全在前端完成，支持以下常见写法（会自动识别中英顺序）：

```
apple 苹果          英文 + 空格 + 中文
apple,苹果          逗号 / 全角逗号
apple - 苹果        短横线 / 破折号
apple | 苹果        竖线
apple：苹果          中英文冒号
apple<Tab>苹果      Tab 分隔
1. apple 苹果       行首序号（1. / 1、/ (1) 等）
abandon vt. 放弃     词性标记会自动移到释义前
苹果 apple          中文在前也能识别
```

粘贴后实时显示识别数量，可点「预览」核对，也能一键「交换中英」。
表头行（如「单词 释义」）与 `#` 开头的注释行会被跳过，重复单词只保留第一条。

背诵支持「认识 / 模糊 / 不认识」三档标记；考核支持选择题（看词选义或看义选词）
与拼写题，并可限定题量。每个单词的熟练度、答题正确率都会记录到云端。
