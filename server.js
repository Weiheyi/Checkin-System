const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// 中间件：验证 Token
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未登录' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token无效' });
        req.user = user;
        next();
    });
}

// ========== 用户认证接口 ==========

// 注册
app.post('/api/register', async (req, res) => {
    const { username, password, nickname } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await db.createUser(username, hashedPassword, nickname);
        
        const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            message: '注册成功', 
            token, 
            user: { id: user.id, username, nickname: user.nickname }
        });
    } catch (err) {
        if (err.message === '用户名已存在' || err.codeName === 'DuplicateKey') {
            return res.status(400).json({ error: '用户名已存在' });
        }
        console.error(err);
        res.status(500).json({ error: '注册失败' });
    }
});

// 登录
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await db.findUser(username);
        
        if (!user) {
            return res.status(400).json({ error: '用户不存在' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: '密码错误' });
        }

        const token = jwt.sign({ id: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            message: '登录成功', 
            token, 
            user: { id: user._id.toString(), username: user.username, nickname: user.nickname }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '登录失败' });
    }
});

// ========== 打卡接口 ==========

// 今日打卡
app.post('/api/checkin', authenticateToken, async (req, res) => {
    const { content } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    try {
        const checkin = await db.createCheckin(userId, today, content || '');
        res.json({ message: '打卡成功', checkinId: checkin.id });
    } catch (err) {
        if (err.message === '今天已经打卡过了') {
            return res.status(400).json({ error: '今天已经打卡过了' });
        }
        console.error(err);
        res.status(500).json({ error: '打卡失败' });
    }
});

// 获取今日打卡状态
app.get('/api/checkin/today', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    try {
        const checkin = await db.getTodayCheckin(userId, today);
        res.json({ checked: !!checkin, checkin });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 添加任务
app.post('/api/tasks', authenticateToken, async (req, res) => {
    const { checkinId, content } = req.body;
    const userId = req.user.id;

    try {
        const task = await db.createTask(userId, checkinId, content);
        res.json({ message: '任务添加成功', taskId: task.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '添加任务失败' });
    }
});

// 获取今日任务
app.get('/api/tasks/today', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    try {
        const tasks = await db.getTodayTasks(userId, today);
        res.json(tasks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 完成任务
app.put('/api/tasks/:id/complete', authenticateToken, async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.id;

    try {
        await db.completeTask(taskId, userId);
        res.json({ message: '任务完成' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除任务
app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.id;

    try {
        await db.deleteTask(taskId, userId);
        res.json({ message: '任务删除成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '删除失败' });
    }
});

// 获取打卡统计
app.get('/api/stats', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const stats = await db.getStats(userId);
        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 获取打卡历史
app.get('/api/history', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 30;

    try {
        const history = await db.getHistory(userId, limit);
        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 启动服务器
(async () => {
    try {
        await db.initDatabase();
        
        app.listen(PORT, () => {
            console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
            console.log(`📦 使用 MongoDB 数据库`);
            console.log(` 访问: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ 服务器启动失败:', err);
        process.exit(1);
    }
})();
