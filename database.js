const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'checkin-system';
const client = new MongoClient(uri);

let usersCollection;
let checkinsCollection;
let tasksCollection;

// 将字符串 ID 转换为 ObjectId，非法 ID 抛出 400 错误
function toId(id) {
    if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== String(id)) {
        const err = new Error('无效的 ID');
        err.status = 400;
        throw err;
    }
    return new ObjectId(id);
}

// 本地时区的 YYYY-MM-DD（避免 toISOString 使用 UTC 导致跨日错位）
function localDateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function shapeTask(task) {
    return {
        id: task._id.toString(),
        user_id: task.user_id,
        checkin_id: task.checkin_id.toString(),
        content: task.content,
        completed: task.completed === 1,
        created_at: task.created_at
    };
}

async function initDatabase() {
    await client.connect();
    console.log('✅ 成功连接到 MongoDB');

    const db = client.db(DB_NAME);
    usersCollection = db.collection('users');
    checkinsCollection = db.collection('checkins');
    tasksCollection = db.collection('tasks');

    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await checkinsCollection.createIndex({ user_id: 1, checkin_date: 1 }, { unique: true });
    await tasksCollection.createIndex({ checkin_id: 1 });
    await tasksCollection.createIndex({ user_id: 1 });

    console.log('✅ 数据库集合和索引创建成功');
}

module.exports = {
    initDatabase,
    localDateStr,

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
        return await usersCollection.findOne({ _id: toId(userId) });
    },

    // 创建打卡记录
    async createCheckin(userId, date, content = '') {
        const existing = await checkinsCollection.findOne({
            user_id: userId,
            checkin_date: date
        });

        if (existing) {
            const err = new Error('今天已经打卡过了');
            err.status = 400;
            throw err;
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

        if (!checkin) return null;

        return {
            id: checkin._id.toString(),
            user_id: checkin.user_id,
            checkin_date: checkin.checkin_date,
            content: checkin.content,
            created_at: checkin.created_at
        };
    },

    // 创建任务
    async createTask(userId, checkinId, content) {
        const checkin = await checkinsCollection.findOne({
            _id: toId(checkinId),
            user_id: userId
        });

        if (!checkin) {
            const err = new Error('打卡记录不存在');
            err.status = 404;
            throw err;
        }

        const result = await tasksCollection.insertOne({
            user_id: userId,
            checkin_id: checkin._id,
            content,
            completed: 0,
            created_at: new Date().toISOString()
        });

        return {
            id: result.insertedId.toString(),
            user_id: userId,
            checkin_id: checkin._id.toString(),
            content,
            completed: false,
            created_at: new Date().toISOString()
        };
    },

    // 获取今日任务
    async getTodayTasks(userId, date) {
        const checkin = await checkinsCollection.findOne({
            user_id: userId,
            checkin_date: date
        });

        if (!checkin) return [];

        const tasks = await tasksCollection
            .find({ checkin_id: checkin._id })
            .sort({ created_at: 1 })
            .toArray();

        return tasks.map(shapeTask);
    },

    // 设置任务完成状态
    async setTaskCompleted(taskId, userId, completed) {
        const result = await tasksCollection.findOneAndUpdate(
            { _id: toId(taskId), user_id: userId },
            { $set: { completed: completed ? 1 : 0 } },
            { returnDocument: 'after' }
        );

        return result ? shapeTask(result) : null;
    },

    // 删除任务
    async deleteTask(taskId, userId) {
        const result = await tasksCollection.deleteOne({
            _id: toId(taskId),
            user_id: userId
        });
        return result.deletedCount > 0;
    },

    // 获取统计数据
    async getStats(userId) {
        const checkins = await checkinsCollection
            .find({ user_id: userId })
            .project({ checkin_date: 1 })
            .toArray();

        const dates = new Set(checkins.map(c => c.checkin_date));

        // 连续打卡天数：从今天开始向前推，今天未打卡则从昨天算起
        const cursor = new Date();
        if (!dates.has(localDateStr(cursor))) {
            cursor.setDate(cursor.getDate() - 1);
        }
        let streak = 0;
        while (dates.has(localDateStr(cursor))) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        const [taskAgg] = await tasksCollection.aggregate([
            { $match: { user_id: userId } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$completed', 1] }, 1, 0] } }
                }
            }
        ]).toArray();

        const totalTasks = taskAgg ? taskAgg.total : 0;
        const completedTasks = taskAgg ? taskAgg.completed : 0;

        return {
            totalDays: checkins.length,
            totalTasks,
            completedTasks,
            completionRate: totalTasks > 0
                ? Math.round((completedTasks / totalTasks) * 100)
                : 0,
            streak
        };
    },

    // 获取打卡历史
    async getHistory(userId, limit = 30) {
        const history = await checkinsCollection.aggregate([
            { $match: { user_id: userId } },
            { $sort: { checkin_date: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: 'tasks',
                    localField: '_id',
                    foreignField: 'checkin_id',
                    as: 'tasks'
                }
            },
            {
                $project: {
                    checkin_date: 1,
                    content: 1,
                    created_at: 1,
                    taskCount: { $size: '$tasks' },
                    completedTaskCount: {
                        $size: {
                            $filter: {
                                input: '$tasks',
                                as: 't',
                                cond: { $eq: ['$$t.completed', 1] }
                            }
                        }
                    }
                }
            }
        ]).toArray();

        return history.map(item => ({
            id: item._id.toString(),
            checkin_date: item.checkin_date,
            content: item.content,
            created_at: item.created_at,
            taskCount: item.taskCount,
            completedTaskCount: item.completedTaskCount
        }));
    }
};
