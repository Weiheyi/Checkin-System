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
- 学习工具：计时器、倒计时（到点响铃）
- 背单词：粘贴单词表、或上传 PDF / Word / 图片自动提取文字，识别后背诵与考核
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
    ├── vendor/                    # 第三方库，全部自包含（无构建、可离线）
    │   ├── supabase.js            # 官方自包含的 supabase-js 构建
    │   ├── pdf.min.mjs            # PDF 文字层提取
    │   ├── pdf.worker.min.mjs
    │   ├── mammoth.browser.min.js # Word(.docx) 解析
    │   ├── tesseract*.js          # 图片 OCR 引擎
    │   └── tesseract-lang/        # OCR 中文识别包
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
        ├── file-extract.js        # 上传文件 → 文本（PDF / Word / 图片 OCR）
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
- 单词本不受 Supabase「单次最多返回 1000 行」的限制影响：前端已改为分页拉取，
  上千词的单词本也能完整加载（该默认值位于 Dashboard → Integrations → Data API → Settings → Max rows）

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

多列表格被拍平成一行时也能正确处理：像
`inimical 一贯正确的 contemplate 沉思 dreary 枯燥的` 这样一行挤了好几组，
会按「中文后面又跟英文」的边界自动切成多条，不会只识别出第一条。

背诵支持「认识 / 模糊 / 不认识」三档标记；考核支持选择题（看词选义或看义选词）
与拼写题。每个单词的熟练度、最近一次结果与答题正确率都会记录到云端。

在「单词」页可以按状态筛选（全部 / 未背 / 认识 / 模糊 / 不认识，数字为该状态的数量），
每行右侧显示最近一次的结果；勾选若干单词后点「考核选中」即可只考这些词。
考核还能按状态限定范围，并用「自定义题量」随机抽取指定数量的题目——
上千词的单词本建议一次抽 50~100 题，而不是一次全考完。

### 关于「背单词」的文件上传

除了粘贴，也可以点「上传文件」，或把文件直接拖到文本框里。
解析全部在本地完成，**文件不会上传到任何服务器**：

| 格式 | 处理方式 | 说明 |
| --- | --- | --- |
| `.pdf` | pdf.js 提取文字层 | 按坐标把「单词 / 释义」两列合并成一行；**扫描版 PDF**（没有文字层）会自动改用 OCR |
| `.docx` | mammoth 解析 | 表格按「单元格 → Tab」还原，最贴合单词表 |
| `.doc` | 先嗅探真实格式 | 实为 docx / RTF 的能正常解析；真正的 Word 97-2003 二进制格式浏览器无法解析，会提示另存为 `.docx` |
| `.jpg` `.png` `.webp` `.bmp` | tesseract.js OCR | 首次使用会加载约 8MB 的识别引擎与中文包，之后走缓存 |
| `.txt` `.rtf` | 直接读取 | RTF 会转成纯文本 |

识别结果会**填进文本框**而不是直接保存，方便你核对、修改后再保存；
文本框里原有的内容不会被覆盖，新内容追加在后面。多个文件可以一次选中。

> **OCR 准确率说明**：用的是 `tessdata_fast` 轻量中文模型，印刷体的英文单词基本无误，
> 中文释义仍可能有个别错字（实测「香蕉」会识成「香基」）。中文部分请务必核对。
> 想提高精度，可把 `public/vendor/tesseract-lang/chi_sim.traineddata` 换成
> [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) 的同名文件（体积约 40MB）。
>
> 另外实测发现中英混合识别（`chi_sim+eng`）反而比单用 `chi_sim` 更容易认错中文，
> 因此这里只用中文模型；它本身包含拉丁字母，英文单词照样能识别。
