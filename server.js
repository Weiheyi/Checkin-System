const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your-secret-key-change-this-in-production';
const dataFile = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ========== 数据管理函数 ==========

function initDataFile() {
    if (!fs.existsSync(dataFile)) {
        const initialData = {
            users: [],
            checkins: [],
            tasks: [],
            userIdCounter: 1,
            checkinIdCounter: 1,
            taskIdCounter: 1
        };
        fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2));
    }
}

function readData() {
    initDataFile();
    const data = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(data);
}

function saveData(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

async function createUser(username, password, nickname) {
    const data = readData();
    const existingUser = data.users.find(u => u.username === username);
    if (existingUser) {
        throw new Error('用户名已存在');
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: data.userIdCounter++,
        username,
        password: hashedPassword,
        nickname: nickname || username,
        created_at: new Date().toISOString()
    };
    
    data.users.push(newUser);
    saveData(data);
    return newUser;
}

function findUser(username) {
    const data = readData();
    return data.users.find(u => u.username === username);
}

function createCheckin(userId, date, content = '') {
    const data = readData();
    
    const existing = data.checkins.find(
        c => c.user_id === userId && c.checkin_date === date
    );
    if (existing) {
        throw new Error('今天已经打卡过了');
    }
    
    const newCheckin = {
        id: data.checkinIdCounter++,
        user_id: userId,
        checkin_date: date,
        content,
        created_at: new Date().toISOString()
    };
    
    data.checkins.push(newCheckin);
    saveData(data);
    return newCheckin;
}

function getTodayCheckin(userId, date) {
    const data = readData();
    return data.checkins.find(
        c => c.user_id === userId && c.checkin_date === date
    );
}

function createTask(userId, checkinId, content) {
    const data = readData();
    
    const newTask = {
        id: data.taskIdCounter++,
        user_id: userId,
        checkin_id: checkinId,
        content,
        completed: 0,
        created_at: new Date().toISOString()
    };
    
    data.tasks.push(newTask);
    saveData(data);
    return newTask;
}

function getTodayTasks(userId, date) {
    const data = readData();
    const checkin = data.checkins.find(
        c => c.user_id === userId && c.checkin_date === date
    );
    
    if (!checkin) return [];
    
    return data.tasks.filter(t => t.checkin_id === checkin.id);
}

function completeTask(taskId, userId) {
    const data = readData();
    const task = data.tasks.find(t => t.id === taskId && t.user_id === userId);
    
    if (task) {
        task.completed = 1;
        saveData(data);
    }
    
    return task;
}

function deleteTask(taskId, userId) {
    const data = readData();
    const index = data.tasks.findIndex(t => t.id === taskId && t.user_id === userId);
    
    if (index !== -1) {
        data.tasks.splice(index, 1);
        saveData(data);
        return true;
    }
    
    return false;
}

function getStats(userId) {
    const data = readData();
    
    const userCheckins = data.checkins.filter(c => c.user_id === userId);
    const userTasks = data.tasks.filter(t => t.user_id === userId);
    
    const totalDays = userCheckins.length;
    const totalTasks = userTasks.length;
    const completedTasks = userTasks.filter(t => t.completed === 1).length;
    
    return {
        totalDays,
        totalTasks,
        completedTasks,
        completionRate: totalTasks > 0 
            ? Math.round((completedTasks / totalTasks) * 100) 
            : 0
    };
}

function getHistory(userId, limit = 30) {
    const data = readData();
    
    const userCheckins = data.checkins
        .filter(c => c.user_id === userId)
        .sort((a, b) => new Date(b.checkin_date) - new Date(a.checkin_date))
        .slice(0, limit);
    
    return userCheckins.map(checkin => {
        const tasks = data.tasks.filter(t => t.checkin_id === checkin.id);
        const completedTasks = tasks.filter(t => t.completed === 1).length;
        
        return {
            ...checkin,
            taskCount: tasks.length,
            completedTaskCount: completedTasks
        };
    });
}

// ========== 中间件 ==========

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未登录' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token无效' });
        req.user = user;
        next();
    });
}

// ========== API 路由 ==========

// 注册
app.post('/api/register', async (req, res) => {
    const { username, password, nickname } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    try {
        const user = await createUser(username, password, nickname);
        const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            message: '注册成功', 
            token, 
            user: { id: user.id, username, nickname: user.nickname }
        });
    } catch (err) {
        if (err.message === '用户名已存在') {
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
        const user = findUser(username);
        
        if (!user) {
            return res.status(400).json({ error: '用户不存在' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: '密码错误' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            message: '登录成功', 
            token, 
            user: { id: user.id, username: user.username, nickname: user.nickname }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '登录失败' });
    }
});

// 今日打卡
app.post('/api/checkin', authenticateToken, (req, res) => {
    const { content } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    try {
        const checkin = createCheckin(userId, today, content || '');
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
app.get('/api/checkin/today', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    try {
        const checkin = getTodayCheckin(userId, today);
        res.json({ checked: !!checkin, checkin });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 添加任务
app.post('/api/tasks', authenticateToken, (req, res) => {
    const { checkinId, content } = req.body;
    const userId = req.user.id;

    try {
        const task = createTask(userId, checkinId, content);
        res.json({ message: '任务添加成功', taskId: task.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '添加任务失败' });
    }
});

// 获取今日任务
app.get('/api/tasks/today', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    try {
        const tasks = getTodayTasks(userId, today);
        res.json(tasks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 完成任务
app.put('/api/tasks/:id/complete', authenticateToken, (req, res) => {
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;

    try {
        completeTask(taskId, userId);
        res.json({ message: '任务完成' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除任务
app.delete('/api/tasks/:id', authenticateToken, (req, res) => {
    const taskId = parseInt(req.params.id);
    const userId = req.user.id;

    try {
        deleteTask(taskId, userId);
        res.json({ message: '任务删除成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '删除失败' });
    }
});

// 获取打卡统计
app.get('/api/stats', authenticateToken, (req, res) => {
    const userId = req.user.id;

    try {
        const stats = getStats(userId);
        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 获取打卡历史
app.get('/api/history', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 30;

    try {
        const history = getHistory(userId, limit);
        res.json(history);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
    console.log(`📂 数据保存在: ${dataFile}`);
});