const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dataFile = path.join(__dirname, 'data.json');

// 初始化数据文件
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

// 读取数据
function readData() {
    initDataFile();
    const data = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(data);
}

// 保存数据
function saveData(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// 用户相关方法
module.exports = {
    // 创建用户
    async createUser(username, password, nickname) {
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
    },

    // 查找用户
    findUser(username) {
        const data = readData();
        return data.users.find(u => u.username === username);
    },

    // 创建打卡记录
    createCheckin(userId, date, content = '') {
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
    },

    // 获取今日打卡
    getTodayCheckin(userId, date) {
        const data = readData();
        return data.checkins.find(
            c => c.user_id === userId && c.checkin_date === date
        );
    },

    // 创建任务
    createTask(userId, checkinId, content) {
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
    },

    // 获取今日任务
    getTodayTasks(userId, date) {
        const data = readData();
        const checkin = data.checkins.find(
            c => c.user_id === userId && c.checkin_date === date
        );
        
        if (!checkin) return [];
        
        return data.tasks.filter(t => t.checkin_id === checkin.id);
    },

    // 完成任务
    completeTask(taskId, userId) {
        const data = readData();
        const task = data.tasks.find(t => t.id === taskId && t.user_id === userId);
        
        if (task) {
            task.completed = 1;
            saveData(data);
        }
        
        return task;
    },

    // 删除任务
    deleteTask(taskId, userId) {
        const data = readData();
        const index = data.tasks.findIndex(t => t.id === taskId && t.user_id === userId);
        
        if (index !== -1) {
            data.tasks.splice(index, 1);
            saveData(data);
            return true;
        }
        
        return false;
    },

    // 获取统计数据
    getStats(userId) {
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
    },

    // 获取打卡历史
    getHistory(userId, limit = 30) {
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
};