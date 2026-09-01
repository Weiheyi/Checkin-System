< !DOCTYPE html >
    <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>学习打卡系统 - 登录</title>
                    <link rel="stylesheet" href="style.css">
                    </head>
                    <body>
                        <!-- 粒子动画背景容器 -->
                        <div class="particles-bg" id="particlesBg"></div>

                        <div class="auth-container">
                            <div class="auth-box">
                                <h1>📚 学习打卡系统</h1>

                                <div class="tabs">
                                    <button class="tab active" onclick="showLogin()">登录</button>
                                    <button class="tab" onclick="showRegister()">注册</button>
                                </div>
                                <!-- 登录表单 -->
                                <form id="loginForm" class="auth-form">
                                    <div class="form-group">
                                        <label>用户名</label>
                                        <input type="text" id="loginUsername" required placeholder="请输入用户名">
                                    </div>
                                    <div class="form-group">
                                        <label>密码</label>
                                        <input type="password" id="loginPassword" required placeholder="请输入密码">
                                    </div>
                                    <button type="submit" class="btn-primary">登录</button>
                                </form>
                                <!-- 注册表单 -->
                                <form id="registerForm" class="auth-form" style="display: none;">
                                    <div class="form-group">
                                        <label>用户名</label>
                                        <input type="text" id="regUsername" required placeholder="请输入用户名">
                                    </div>
                                    <div class="form-group">
                                        <label>昵称</label>
                                        <input type="text" id="regNickname" placeholder="请输入昵称（可选）">
                                    </div>
                                    <div class="form-group">
                                        <label>密码</label>
                                        <input type="password" id="regPassword" required placeholder="请输入密码">
                                    </div>
                                    <div class="form-group">
                                        <label>确认密码</label>
                                        <input type="password" id="regPasswordConfirm" required placeholder="请再次输入密码">
                                    </div>
                                    <button type="submit" class="btn-primary">注册</button>
                                </form>
                                <div id="message" class="message"></div>
                            </div>
                        </div>
                        <script src="app.js"></script>
                        <!-- 粒子生成脚本 -->
                        <script>
                            const particlesBg = document.getElementById('particlesBg');
                            if (particlesBg) {
            for (let i = 0; i < 60; i++) {
                const particle = document.createElement('div');
                            particle.className = 'particle';
                            particle.style.left = Math.random() * 100 + '%';
                            particle.style.animationDelay = Math.random() * 8 + 's';
                            particle.style.animationDuration = (5 + Math.random() * 10) + 's';
                            particle.style.width = particle.style.height = (1 + Math.random() * 3) + 'px';
                            particle.style.opacity = 0.2 + Math.random() * 0.4;
                            particlesBg.appendChild(particle);
            }
        }
                        </script>
                    </body>
                </html>
