# 🐰 Rabbit Lark Bot

**飞书 AI 机器人平台** — 将飞书消息桥接到任意 AI Agent，内置用户权限管理和催办任务系统。

---

## 功能概览

| 模块 | 描述 |
|------|------|
| **AI 桥接** | 飞书消息 → AI Agent（OpenClaw / LangChain / 任意 Webhook） |
| **权限系统** | 基于角色（superadmin / admin / user）+ 每用户功能开关 |
| **催办任务** | 飞书命令创建任务、定时提醒、截止通报、完成通知 |
| **用户管理** | 自动注册飞书用户，收集姓名/邮箱/手机号 |
| **管理后台** | Next.js Web Dashboard，任务/用户/权限/日志管理 |

---

## 架构

```
飞书用户 → 飞书服务器 → /webhook/event
                              │
                      ┌───────▼────────────────────────────────┐
                      │           Rabbit Lark Server            │
                      │                                         │
                      │  1. 解密 / 去重 / 用户自动注册          │
                      │  2. 意图检测（greeting/menu/cuiban/AI） │
                      │  3. 权限检查                           │
                      │  4. 催办命令处理 OR 转发 AI Agent       │
                      └───────┬─────────────────┬──────────────┘
                              │                 │
                    ┌─────────▼──────┐  ┌───────▼──────────┐
                    │   PostgreSQL   │  │   AI Agent        │
                    │  users / tasks │  │  (OpenClaw/其他)  │
                    │  sessions/logs │  └──────────────────┘
                    └────────────────┘
                              │
                    ┌─────────▼──────┐
                    │  Web Dashboard │
                    │  (Next.js:3000)│
                    └────────────────┘
```

---

## 目录结构

```
rabbit-lark-bot/
├── docker-compose.yml
├── .env                        # 配置（不提交到 Git）
├── db/
│   ├── init.sql                # 数据库初始化（完整 schema）
│   └── migrations/             # 增量迁移（001~007）
├── packages/
│   ├── server/                 # Express API + Webhook + 业务逻辑
│   │   └── src/
│   │       ├── index.js        # 入口 + 定时任务
│   │       ├── routes/
│   │       │   ├── webhook.js  # 飞书事件处理
│   │       │   ├── api.js      # 管理 REST API
│   │       │   ├── agent.js    # AI Agent API
│   │       │   └── users.js    # 用户管理 API
│   │       ├── services/
│   │       │   ├── reminder.js     # 催办任务服务
│   │       │   └── agentForwarder.js
│   │       ├── db/
│   │       │   ├── pool.js     # 数据库连接池
│   │       │   ├── users.js    # 用户 CRUD
│   │       │   ├── sessions.js # 会话持久化
│   │       │   └── index.js    # admins / settings / audit
│   │       ├── features/
│   │       │   └── index.js    # 权限注册表 + resolveFeatures()
│   │       ├── feishu/
│   │       │   └── client.js   # 飞书 API 客户端
│   │       └── utils/
│   │           ├── intentDetector.js   # 意图分类
│   │           ├── menuBuilder.js      # 动态菜单
│   │           └── logger.js
│   ├── web/                    # Next.js 管理后台
│   │   └── src/
│   │       ├── app/
│   │       │   ├── page.tsx        # Dashboard
│   │       │   ├── tasks/          # 催办任务管理
│   │       │   └── users/          # 用户管理
│   │       ├── components/
│   │       │   └── UserCombobox.tsx  # 用户搜索下拉
│   │       └── lib/api.ts
│   ├── mcp/                    # MCP Server（Agent 操作飞书）
│   └── openclaw-plugin/        # OpenClaw 频道插件
├── scripts/
│   └── enrich-users.js         # 手动补全用户信息
└── docs/
    ├── architecture.md
    └── api.md
```

---

## 快速开始

### 1. 前置条件

- Docker + Docker Compose
- 飞书开放平台应用（App ID + Secret）
- 公网可访问的服务器

### 2. 配置环境变量

```bash
cp .env.example .env
vim .env
```

**必填：**
```env
# 数据库
POSTGRES_USER=rabbit
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=rabbit_lark

# 飞书应用
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=your_app_secret
FEISHU_ENCRYPT_KEY=your_encrypt_key    # 飞书事件加密密钥

# AI Agent
AGENT_WEBHOOK_URL=http://host.docker.internal:18789/channels/lark/webhook
API_BASE_URL=http://your-server:3456
```

**可选：**
```env
# 任务提醒设置
DEFAULT_DEADLINE_DAYS=3            # 默认截止天数（默认 3）
DEFAULT_REMINDER_INTERVAL_HOURS=24 # 默认提醒间隔（默认 24 小时）
REMINDER_CHECK_INTERVAL_MINUTES=15 # Cron 扫描频率（默认 15 分钟）

# 其他
API_KEY=your_api_key               # 管理 API 鉴权（留空则不鉴权）
LOG_LEVEL=info                     # error / warn / info / debug
```

### 3. 启动服务

```bash
docker compose up -d

# 查看日志
docker compose logs -f server

# 检查健康状态
curl http://localhost:3456/health
```

服务端口：
- `3456` — API Server + Feishu Webhook
- `3000` — Web Dashboard（默认密码：`adminrabbit`）
- `5432` — PostgreSQL（仅本地访问）

### 4. 配置飞书

1. 打开 [飞书开放平台](https://open.feishu.cn/app) → 选择你的应用
2. **添加应用能力** → 机器人
3. **事件订阅** → 请求 URL：`http://YOUR_SERVER:3456/webhook/event`
4. **添加事件**：`im.message.receive_v1`
5. **权限管理** → 开通以下权限：
   - `im:message` — 发送/接收消息
   - `im:message:send_as_bot` — 机器人发消息
   - `contact:contact.base:readonly` — 获取用户姓名（需发布新版本生效）
6. 发布应用版本

### 5. 接入 AI Agent

配置 `AGENT_WEBHOOK_URL` 为你的 Agent 接收端点。飞书消息会以如下格式 POST 过去：

```json
{
  "source": { "bridge": "rabbit-lark-bot", "platform": "lark" },
  "reply_via": { "api": "http://your-server:3456/api/agent/send" },
  "message_id": "om_xxx",
  "chat_id": "oc_xxx",
  "user": { "id": "ou_xxx", "role": "user", "allowedFeatures": ["cuiban_view"] },
  "content": { "type": "text", "text": "Hello!" }
}
```

Agent 通过 `POST /api/agent/send` 回复：

```bash
curl -X POST http://your-server:3456/api/agent/send \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "oc_xxx", "content": "你好！"}'
```

---

## 催办任务系统

### 飞书命令

| 命令 | 权限 | 说明 |
|------|------|------|
| `我的任务` / `任务列表` | 全部用户 | 查看自己的待办任务 |
| `完成 [任务名/序号]` | 全部用户 | 标记任务完成，可附上证明链接 |
| `/add 任务名 邮箱/姓名 [日期]` | admin+ | 创建催办任务并通知执行人 |

**示例：**
```
/add 提交季度报告 lisi@company.com 2026-03-31
/add 更新文档 李四 2026-03-31
完成 https://docs.example.com/proof
```

### 通知逻辑

```
任务创建
  └─→ 执行人收到：「你收到一个新的催办任务」

每 N 小时（reminder_interval_hours）
  └─→ 执行人收到：「⏰ 催办提醒」（逾期时加 ⚠️ 标记）

截止时间一到（一次性）
  ├─→ 执行人收到：「🚨 任务已逾期，请尽快完成」
  └─→ 报告对象收到：「📢 催办任务逾期通报」

任务完成
  └─→ 报告对象收到：「✅ 催办任务已完成 + 完成人 + 时间 + 证明」
```

### 通过管理后台创建任务

Web Dashboard → 催办任务 → 创建任务：

| 字段 | 说明 |
|------|------|
| 任务名称 | 必填 |
| 催办对象 | 从用户库搜索（姓名/邮箱），存 open_id |
| 报告对象 | 可选，任务完成/逾期时收通知 |
| 截止时间 | 可选，到期触发一次性逾期通报 |
| 提醒间隔 | 小时数，0 = 关闭，默认 24 |
| 备注 | 可选说明 |

---

## 权限系统

### 角色

| 角色 | 默认功能 |
|------|---------|
| `user` | `cuiban_view`、`cuiban_complete` |
| `admin` | 以上 + `cuiban_create`、`history`、`user_manage` |
| `superadmin` | 全部功能 |

### 功能列表

| Feature ID | 说明 |
|-----------|------|
| `cuiban_view` | 查看自己的催办任务 |
| `cuiban_complete` | 完成催办任务 |
| `cuiban_create` | 创建/发布催办任务 |
| `history` | 查看历史消息 |
| `user_manage` | 管理用户权限 |
| `feature_manage` | 管理功能开关 |
| `system_config` | 系统配置 |

角色权限可在管理后台对每个用户单独覆盖。

---

## 用户注册

用户第一次向机器人发送消息时自动注册：

1. 飞书事件中提取 `open_id`、`union_id`
2. 调用 Feishu Contact API（需 `contact:contact.base:readonly`）获取姓名
3. 写入 `users` 表，角色默认 `user`

**手动补全存量用户信息：**
```bash
DATABASE_URL=postgres://rabbit:password@localhost:5432/rabbit_lark \
NODE_PATH=packages/server/node_modules \
node scripts/enrich-users.js
```

---

## 数据库 Schema

| 表 | 用途 |
|----|------|
| `users` | 飞书用户，含角色和功能覆盖 |
| `tasks` | 催办任务，含执行人/报告人/提醒设置 |
| `user_sessions` | 多步交互会话（重启后恢复） |
| `settings` | 系统配置 KV |
| `audit_logs` | 操作审计日志 |
| `admins` | 遗留表，向后兼容 |

详见 [docs/architecture.md](docs/architecture.md)。

---

## 开发

```bash
# 仅启动数据库
docker compose up -d rabbit-lark-db

# 本地开发 Server
cd packages/server
npm install
DATABASE_URL=postgres://rabbit:rabbit_secret_123@localhost:5432/rabbit_lark \
npm run dev

# 本地开发 Web
cd packages/web
npm install
npm run dev    # http://localhost:3000
```

**测试：**
```bash
cd packages/server && npm test
```

**数据库迁移：**
```bash
# 应用某个迁移文件
docker exec rabbit-lark-db psql -U rabbit -d rabbit_lark \
  -f /dev/stdin < db/migrations/007_add_deadline_notified_at.sql
```

---

## 文档

- [架构设计](docs/architecture.md) — 系统架构、数据库 Schema、数据流
- [API 文档](docs/api.md) — 完整 REST API 说明
- [更新日志](CHANGELOG.md)

## License

MIT
