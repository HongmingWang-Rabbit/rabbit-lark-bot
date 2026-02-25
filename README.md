# 🐰 Rabbit Lark Bot

飞书自动化工具集 Monorepo，包含：
- **Server** - API 服务 + 飞书 Webhook
- **Web** - 管理后台 Dashboard
- **Scripts** - CLI 工具脚本

## 目录结构

```
rabbit-lark-bot/
├── docker-compose.yml      # 服务编排
├── .env                    # 配置文件（不提交）
├── db/
│   └── init.sql            # 数据库初始化
├── packages/
│   ├── server/             # API + Webhook 服务
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.js
│   │       ├── routes/     # API 路由
│   │       ├── services/   # 业务逻辑
│   │       ├── db/         # 数据库操作
│   │       └── feishu/     # 飞书 API 封装
│   ├── web/                # Next.js 管理后台
│   │   ├── Dockerfile
│   │   └── src/app/
│   │       ├── page.tsx        # Dashboard
│   │       ├── tasks/          # 任务管理
│   │       ├── admins/         # 管理员管理
│   │       └── settings/       # 系统设置
│   └── scripts/            # CLI 工具
│       ├── reminder.sh
│       └── feishu.sh
└── docs/
```

## 快速开始

### 1. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录后生效
```

### 2. 配置

```bash
cp .env.example .env
vim .env
```

必填项：
```env
# 数据库
POSTGRES_USER=rabbit
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=rabbit_lark

# 飞书应用
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 多维表格
REMINDER_APP_TOKEN=xxx
REMINDER_TABLE_ID=xxx
```

### 3. 启动

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

服务端口：
- **3456** - API Server + Webhook
- **3000** - Web Dashboard
- **5432** - PostgreSQL（仅本地访问）

### 4. 配置飞书

1. 打开 [飞书开放平台](https://open.feishu.cn/app)
2. 事件订阅 → 请求地址: `http://YOUR_SERVER:3456/webhook/event`
3. 添加事件: `im.message.receive_v1`
4. 开通权限: `bitable:app`, `im:message`

## API 接口

### Dashboard
- `GET /api/dashboard` - 获取统计数据

### Tasks
- `GET /api/tasks` - 任务列表
- `POST /api/tasks` - 创建任务
- `POST /api/tasks/:id/complete` - 完成任务
- `DELETE /api/tasks/:id` - 删除任务

### Admins
- `GET /api/admins` - 管理员列表
- `POST /api/admins` - 添加管理员
- `DELETE /api/admins/:userId` - 移除管理员

### Settings
- `GET /api/settings` - 配置列表
- `PUT /api/settings/:key` - 更新配置

### Audit
- `GET /api/audit` - 审计日志

## 用户权限

### Admin（管理员）
- 创建/删除任务
- 查看所有任务
- 管理其他管理员
- 修改系统设置

### User（普通用户）
- 查看自己的待办任务
- 完成任务并提交证明

## 飞书机器人交互

**普通用户：**
- 发送「任务」→ 查看待办
- 发送「完成」或链接 → 完成任务

**管理员：**
- `/all` → 查看所有任务
- `/pending` → 查看待办任务

## 开发

```bash
# 只启动数据库
docker-compose up -d postgres

# 本地开发 Server
cd packages/server
npm install
DATABASE_URL=postgres://rabbit:xxx@localhost:5432/rabbit_lark npm run dev

# 本地开发 Web
cd packages/web
npm install
npm run dev
```

## License

MIT
