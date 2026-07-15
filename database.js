const { MongoClient } = require('mongodb');

// MongoDB 连接字符串
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

let db;
let usersCollection;
let checkinsCollection;
let tasksCollection;

// 初始化数据库连接
async function initDatabase() {
    try {
        await client.connect();
        console.log('✅ 成功连接到 MongoDB');
        
        db = client.db('checkin-system');
        usersCollection = db.collection('users');
        checkinsCollection = db.collection('checkins');
        tasksCollection = db.collection('tasks');
        
        // 创建索引
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await checkinsCollection.createIndex({ user_id: 1, checkin_date: 1 }, { unique: true });
        
        console.log('✅ 数据库集合和索引创建成功');
    } catch (err) {
        console.error('❌ 数据库连接失败:', err);
        process.exit(1);
    }
}

// 用户相关方法
module.exports = {
    initDatabase,
    
    // 创建用户
    async createUser(username, password, nickname) {
        const result = await usersCollection.insertOne({
            username,
            password,
            nickname: nickname || username,
            created_at: new Date().toISOString()
        });
        return { 
            id: result.insertedId.toString(), 
            username, 
            nickname: nickname || username 
        };
    },

    // 查找用户
    async findUser(username) {
        return await usersCollection.findOne({ username });
    },

    // 查找用户 by ID
    async findUserById(userId) {
        const { ObjectId } = require('mongodb');
        return await usersCollection.findOne({ _id: new ObjectId(userId) });
    },

    // 创建打卡记录
    async createCheckin(userId, date, content = '') {
        const existing = await checkinsCollection.findOne({
            user_id: userId,
            checkin_date: date
        });
        
        if (existing) {
            throw new Error('今天已经打卡过了');
        }
        
        const result = await checkinsCollection.insertOne({
            user_id: userId,
            checkin_date: date,
            content,
            created_at: new Date().toISOString()
        });
        
        return { 
            id: result.insertedId.toString(), 
            user_id: userId, 
            checkin_date: date, 
            content 
        };
    },

    // 获取今日打卡
    async getTodayCheckin(userId, date) {
        const checkin = await checkinsCollection.findOne({
            user_id: userId,
            checkin_date: date
        });
        
        if (checkin) {
            return {
                id: checkin._id.toString(),
                user_id: checkin.user_id,
                checkin_date: checkin.checkin_date,
                content: checkin.content,
                created_at: checkin.created_at
            };
        }
        return null;
    },

    // 创建任务
    async createTask(userId, checkinId, content) {
        const { ObjectId } = require('mongodb');
        
        const result = await tasksCollection.insertOne({
            user_id: userId,
            checkin_id: new ObjectId(checkinId),
            content,
            completed: 0,
            created_at: new Date().toISOString()
        });
        
        return { 
            id: result.insertedId.toString(), 
            user_id: userId, 
            checkin_id: checkinId, 
            content 
        };
    },

    // 获取今日任务
    async getTodayTasks(userId, date) {
        const checkin = await checkinsCollection.findOne({
            user_id: userId,
            checkin_date: date
        });
        
        if (!checkin) return [];
        
        const tasks = await tasksCollection.find({ 
            checkin_id: checkin._id 
        }).toArray();
        
        return tasks.map(task => ({
            id: task._id.toString(),
            user_id: task.user_id,
            checkin_id: task.checkin_id.toString(),
            content: task.content,
            completed: task.completed,
            created_at: task.created_at
        }));
    },

    // 完成任务
    async completeTask(taskId, userId) {
        const { ObjectId } = require('mongodb');
        
        await tasksCollection.updateOne(
            { _id: new ObjectId(taskId), user_id: userId },
            { $set: { completed: 1 } }
        );
    },

    // 删除任务
    async deleteTask(taskId, userId) {
        const { ObjectId } = require('mongodb');
        
        const result = await tasksCollection.deleteOne({
            _id: new ObjectId(taskId),
            user_id: userId
        });
        return result.deletedCount > 0;
    },

    // 获取统计数据
    async getStats(userId) {
        const totalDays = await checkinsCollection.countDocuments({ user_id: userId });
        
        const userTasks = await tasksCollection.find({ user_id: userId }).toArray();
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
    async getHistory(userId, limit = 30) {
        const checkins = await checkinsCollection
            .find({ user_id: userId })
            .sort({ checkin_date: -1 })
            .limit(limit)
            .toArray();
        
        const history = await Promise.all(checkins.map(async (checkin) => {
            const tasks = await tasksCollection.find({ 
                checkin_id: checkin._id 
            }).toArray();
            const completedTasks = tasks.filter(t => t.completed === 1).length;
            
            return {
                id: checkin._id.toString(),
                user_id: checkin.user_id,
                checkin_date: checkin.checkin_date,
                content: checkin.content,
                created_at: checkin.created_at,
                taskCount: tasks.length,
                completedTaskCount: completedTasks
            };
        }));
        
        return history;
    }
};
