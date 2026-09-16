require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_SECRET = 'your-secret-key-change-this-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 统一包装异步路由，异常交由错误中间件处理
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function shapeUser(user) {
    return {
        id: String(user.id || user._id),
        username: user.username,
        nickname: user.nickname
    };
}

function signToken(user) {
    return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

// 中间件：验证 Token
function authenticateToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: '未登录' });

    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) return res.status(403).json({ error: '登录已过期，请重新登录' });
        req.user = payload;
        next();
    });
}

// ========== 用户认证接口 ==========

// 注册
app.post('/api/register', wrap(async (req, res) => {
    const { username, password, nickname } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (String(username).trim().length < 3) {
        return res.status(400).json({ error: '用户名至少 3 个字符' });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ error: '密码至少 6 位' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user;
    try {
        user = await db.createUser(String(username).trim(), hashedPassword, nickname);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        throw err;
    }

    const shaped = shapeUser(user);
    res.json({ message: '注册成功', token: signToken(shaped), user: shaped });
}));

// 登录
app.post('/api/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = await db.findUser(username);
    const validPassword = user && await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(400).json({ error: '用户名或密码错误' });
    }

    const shaped = shapeUser(user);
    res.json({ message: '登录成功', token: signToken(shaped), user: shaped });
}));

// 当前用户信息
app.get('/api/me', authenticateToken, wrap(async (req, res) => {
    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: shapeUser(user) });
}));

// ========== 打卡接口 ==========

// 今日打卡
app.post('/api/checkin', authenticateToken, wrap(async (req, res) => {
    const { content } = req.body || {};
    const today = db.localDateStr();
    const checkin = await db.createCheckin(req.user.id, today, content || '');
    res.json({ message: '打卡成功', checkin });
}));

// 获取今日打卡状态与任务
app.get('/api/checkin/today', authenticateToken, wrap(async (req, res) => {
    const today = db.localDateStr();
    const checkin = await db.getTodayCheckin(req.user.id, today);
    const tasks = checkin ? await db.getTodayTasks(req.user.id, today) : [];
    res.json({ checked: !!checkin, checkin, tasks });
}));

// 添加任务
app.post('/api/tasks', authenticateToken, wrap(async (req, res) => {
    const { content, checkinId } = req.body || {};

    if (!content || !String(content).trim()) {
        return res.status(400).json({ error: '任务内容不能为空' });
    }

    let cid = checkinId;
    if (!cid) {
        const checkin = await db.getTodayCheckin(req.user.id, db.localDateStr());
        if (!checkin) return res.status(400).json({ error: '请先打卡' });
        cid = checkin.id;
    }

    const task = await db.createTask(req.user.id, cid, String(content).trim());
    res.json({ message: '任务添加成功', task });
}));

// 更新任务完成状态
app.put('/api/tasks/:id', authenticateToken, wrap(async (req, res) => {
    const { completed } = req.body || {};
    if (typeof completed !== 'boolean') {
        return res.status(400).json({ error: 'completed 必须为布尔值' });
    }

    const task = await db.setTaskCompleted(req.params.id, req.user.id, completed);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ message: '更新成功', task });
}));

// 删除任务
app.delete('/api/tasks/:id', authenticateToken, wrap(async (req, res) => {
    const deleted = await db.deleteTask(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: '任务不存在' });
    res.json({ message: '任务已删除' });
}));

// 获取打卡统计
app.get('/api/stats', authenticateToken, wrap(async (req, res) => {
    const stats = await db.getStats(req.user.id);
    res.json(stats);
}));

// 获取打卡历史
app.get('/api/history', authenticateToken, wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const history = await db.getHistory(req.user.id, limit);
    res.json(history);
}));

// 未匹配的接口
app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理
app.use((err, req, res, next) => {
    if (err && err.status) {
        return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
(async () => {
    try {
        if (JWT_SECRET === DEFAULT_SECRET) {
            console.warn('⚠️  正在使用默认 JWT_SECRET，生产环境请在 .env 中配置随机密钥');
        }

        await db.initDatabase();

        app.listen(PORT, () => {
            console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
            console.log(`📦 使用 MongoDB 数据库`);
        });
    } catch (err) {
        console.error('❌ 服务器启动失败:', err.message);
        process.exit(1);
    }
})();
