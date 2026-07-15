const API_URL = '/api';
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

// ========== 认证相关 ==========

function showLogin() {
    document.getElementById('loginForm').style.display = 'flex';
    document.getElementById('registerForm').style.display = 'none';
    document.querySelectorAll('.tab')[0].classList.add('active');
    document.querySelectorAll('.tab')[1].classList.remove('active');
}

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'flex';
    document.querySelectorAll('.tab')[1].classList.add('active');
    document.querySelectorAll('.tab')[0].classList.remove('active');
}

// 注册
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('regUsername').value;
    const nickname = document.getElementById('regNickname').value;
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;

    if (password !== passwordConfirm) {
        showMessage('两次密码输入不一致', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, nickname, password })
        });

        const data = await response.json();
        
        if (response.ok) {
            token = data.token;
            currentUser = data.user;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(currentUser));
            showMessage('注册成功！正在跳转...', 'success');
            setTimeout(() => window.location.href = 'dashboard.html', 1000);
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('网络错误，请稍后重试', 'error');
    }
});

// 登录
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        
        if (response.ok) {
            token = data.token;
            currentUser = data.user;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(currentUser));
            showMessage('登录成功！正在跳转...', 'success');
            setTimeout(() => window.location.href = 'dashboard.html', 1000);
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('网络错误，请稍后重试', 'error');
    }
});

function showMessage(text, type) {
    const msgEl = document.getElementById('message');
    if (msgEl) {
        msgEl.textContent = text;
        msgEl.className = `message show ${type}`;
        setTimeout(() => msgEl.classList.remove('show'), 3000);
    }
}

// ========== 主页功能 ==========

function checkAuth() {
    if (!token) {
        window.location.href = 'index.html';
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

function initDashboard() {
    if (!document.getElementById('checkInBtn')) return;
    
    // 显示用户信息
    if (currentUser) {
        document.getElementById('userName').textContent = currentUser.nickname || currentUser.username;
    }
    
    // 显示日期
    const date = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    document.getElementById('currentDate').textContent = date.toLocaleDateString('zh-CN', options);
    
    // 加载数据
    loadTodayStatus();
    loadStats();
    loadHistory();
}

async function loadTodayStatus() {
    try {
        const response = await fetch(`${API_URL}/checkin/today`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        const btn = document.getElementById('checkInBtn');
        const taskSection = document.getElementById('taskSection');
        
        if (data.checked) {
            btn.textContent = '✓ 已打卡';
            btn.classList.add('checked');
            btn.disabled = true;
            taskSection.style.display = 'block';
            loadTasks();
        } else {
            btn.onclick = checkIn;
        }
    } catch (error) {
        console.error('加载状态失败', error);
    }
}

async function checkIn() {
    try {
        const response = await fetch(`${API_URL}/checkin`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: '' })
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('checkInBtn').textContent = '✓ 已打卡';
            document.getElementById('checkInBtn').classList.add('checked');
            document.getElementById('checkInBtn').disabled = true;
            document.getElementById('taskSection').style.display = 'block';
            alert('打卡成功！继续加油！');
        } else {
            const data = await response.json();
            alert(data.error);
        }
    } catch (error) {
        alert('打卡失败，请稍后重试');
    }
}

async function loadTasks() {
    try {
        const response = await fetch(`${API_URL}/tasks/today`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const tasks = await response.json();
        renderTasks(tasks);
    } catch (error) {
        console.error('加载任务失败', error);
    }
}

function renderTasks(tasks) {
    const list = document.getElementById('taskList');
    list.innerHTML = '';
    
    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item';
        li.innerHTML = `
            <input type="checkbox" class="task-checkbox" 
                   ${task.completed ? 'checked' : ''} 
                   onchange="toggleTask(${task.id})">
            <span class="task-text ${task.completed ? 'completed' : ''}">${task.content}</span>
            <button class="delete-btn" onclick="deleteTask(${task.id})">删除</button>
        `;
        list.appendChild(li);
    });
}

async function addTask() {
    const input = document.getElementById('taskInput');
    const content = input.value.trim();
    
    if (!content) {
        alert('请输入任务内容');
        return;
    }

    // 先获取今天的打卡ID
    const checkinRes = await fetch(`${API_URL}/checkin/today`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const checkinData = await checkinRes.json();
    
    if (!checkinData.checkin) {
        alert('请先打卡');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/tasks`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                checkinId: checkinData.checkin.id, 
                content 
            })
        });
        
        if (response.ok) {
            input.value = '';
            loadTasks();
        }
    } catch (error) {
        alert('添加任务失败');
    }
}

async function toggleTask(taskId) {
    try {
        await fetch(`${API_URL}/tasks/${taskId}/complete`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        loadTasks();
        loadStats();
    } catch (error) {
        console.error('更新任务失败', error);
    }
}

async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const stats = await response.json();
        
        document.getElementById('totalDays').textContent = stats.totalDays;
        document.getElementById('totalTasks').textContent = stats.completedTasks;
        document.getElementById('completionRate').textContent = stats.completionRate + '%';
    } catch (error) {
        console.error('加载统计失败', error);
    }
}

async function loadHistory() {
    try {
        const response = await fetch(`${API_URL}/history?limit=10`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const history = await response.json();
        
        const container = document.getElementById('historyList');
        container.innerHTML = '';
        
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="history-date">${item.checkin_date}</div>
                <div class="history-content">
                    完成任务: ${item.completedTaskCount}/${item.taskCount}
                </div>
            `;
            container.appendChild(div);
        });
    } catch (error) {
        console.error('加载历史失败', error);
    }
}

// 支持回车添加任务
document.getElementById('taskInput')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        addTask();
    }
});
