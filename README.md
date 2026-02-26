# 🐰 Rabbit Lark Bot

**让任何 AI Agent 接入飞书的桥接服务**

Rabbit Lark Bot 是一个消息桥接平台，将飞书消息转发给 AI Agent，并让 Agent 通过 MCP 或 API 回复。支持任意 AI Agent 框架（Clawdbot、LangChain、AutoGPT 等）无缝接入飞书。

## 包含组件

- **Server** - API 服务 + 飞书 Webhook + Agent 转发
- **MCP** - Model Context Protocol 服务器（让 Agent 操作飞书）
- **Web** - 管理后台 Dashboard
- **Scripts** - CLI 工具脚本

## 架构

```
┌─────────────────┐         ┌──────────────────────────────────┐
│   Lark/Feishu   │◄───────►│      Rabbit Lark Bot Server      │
│   (用户消息)     │         │  - 接收飞书 Webhook               │
└─────────────────┘         │  - 转发消息到 AI Agent            │
                            │  - 提供 Agent API                 │
                            └──────────────┬───────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
           ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
           │   Clawdbot    │      │   LangChain   │      │  Your Agent   │
           │  (via MCP)    │      │  (via API)    │      │  (via API)    │
           └───────────────┘      └───────────────┘      └───────────────┘
```

### 消息格式（发送给 Agent）

```json
{
  "source": {
    "bridge": "rabbit-lark-bot",
    "platform": "lark",
    "version": "1.0.0",
    "capabilities": ["text", "image", "file", "reply", "reaction"]
  },
  "reply_via": {
    "mcp": "rabbit-lark",
    "api": "https://your-server.com/api/agent/send"
  },
  "event": "message",
  "message_id": "om_xxx",
  "chat_id": "oc_xxx",
  "user": { "id": "ou_xxx", "type": "user" },
  "content": { "type": "text", "text": "Hello!" },
  "timestamp": 1234567890
}
```

## 目录结构

```
rabbit-lark-bot/
├── docker-compose.yml      # 服务编排
├── .env                    # 配置文件（不提交）
├── db/
│   ├── init.sql            # 数据库初始化
│   └── migrations/         # 数据库迁移
├── packages/
│   ├── server/             # API + Webhook + Agent 转发
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── webhook.js   # 飞书事件接收
│   │       │   └── agent.js     # Agent API
│   │       └── services/
│   │           └── agentForwarder.js  # 消息转发
│   ├── mcp/                # MCP Server（让 Agent 操作飞书）
│   │   └── src/index.js
│   ├── web/                # Next.js 管理后台
│   └── scripts/            # CLI 工具
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

# 只启动 postgres + server（跳过 web）
docker-compose up -d postgres server

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

服务端口：
- **3456** - API Server + Webhook
- **3000** - Web Dashboard
- **5432** - PostgreSQL（仅本地访问）

> **Docker 网络说明：** Server 容器已配置 `extra_hosts`，可通过 `host.docker.internal` 访问宿主机服务。如果你的 AI Agent 运行在宿主机上（如 OpenClaw），将 `AGENT_WEBHOOK_URL` 设为 `http://host.docker.internal:<port>`。

### 4. 配置飞书

1. 打开 [飞书开放平台](https://open.feishu.cn/app)
2. 事件订阅 → 请求地址: `http://YOUR_SERVER:3456/webhook/event`
3. 添加事件: `im.message.receive_v1`
4. 开通权限: `bitable:app`, `im:message`

### 5. 接入你的 AI Agent

**单 Agent 模式** — 一个 Rabbit Lark 实例绑定一个 AI Agent。

**步骤 1：配置 Agent Webhook**

在 `.env` 中设置你的 agent 接收消息的 endpoint：

```env
# Agent 接收消息的 webhook 地址
AGENT_WEBHOOK_URL=https://your-agent.com/lark-webhook

# 可选：共享密钥，用于验证消息签名
AGENT_API_KEY=your_shared_secret

# 本服务的公网地址（agent 回复时需要）
API_BASE_URL=https://your-rabbit-server.com
```

当飞书用户发消息时，Rabbit 会 POST 到你的 `AGENT_WEBHOOK_URL`。

**步骤 2：Agent 侧接收消息**

你的 agent 会收到这样的 POST 请求：

```json
{
  "source": { "bridge": "rabbit-lark-bot", "platform": "lark" },
  "reply_via": {
    "mcp": "rabbit-lark",
    "api": "https://your-rabbit-server.com/api/agent/send"
  },
  "message_id": "om_xxx",
  "chat_id": "oc_xxx",
  "user": { "id": "ou_xxx" },
  "content": { "type": "text", "text": "Hello!" }
}
```

**步骤 3：Agent 回复（两种方式）**

**方式 A：使用 MCP（推荐，适用于 Claude/Clawdbot）**

```bash
cd packages/mcp && npm install && npm link
```

在 Claude Desktop 或 Clawdbot 中配置：

```json
{
  "mcpServers": {
    "rabbit-lark": {
      "command": "rabbit-lark-mcp",
      "env": {
        "RABBIT_LARK_API_URL": "https://your-rabbit-server.com",
        "RABBIT_LARK_API_KEY": "your-api-key"
      }
    }
  }
}
```

Agent 调用 `rabbit_lark_send` 工具即可回复。

**方式 B：直接调用 API**

```bash
curl -X POST https://your-rabbit-server.com/api/agent/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "ou_xxx", "content": "Hello from AI!"}'
```

## API 接口

### Agent API（核心）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agent/status` | GET | 检查 agent 配置状态 |
| `/api/agent/send` | POST | 发送消息到飞书 |
| `/api/agent/reply` | POST | 回复特定消息 |
| `/api/agent/react` | POST | 添加表情回应 |
| `/api/agent/history` | GET | 获取消息历史 |
| `/api/agent/user/:id` | GET | 获取用户信息 |
| `/api/agent/schema` | GET | 获取消息格式文档 |

### 管理 API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/dashboard` | GET | Dashboard 统计 |
| `/api/tasks` | GET/POST | 任务列表/创建 |
| `/api/admins` | GET/POST | 管理员列表/添加 |
| `/api/settings` | GET/PUT | 配置管理 |
| `/api/audit` | GET | 审计日志 |

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

## 测试

```bash
# Server 测试
cd packages/server
npm test              # 运行测试
npm run test:watch    # 监听模式
npm run test:coverage # 生成覆盖率报告

# Web 测试
cd packages/web
npm test

# Lint
npm run lint
npm run lint:fix
```

## CI/CD

GitHub Actions 配置：

- **CI** (`.github/workflows/ci.yml`)
  - 推送到 main/develop 或 PR 时触发
  - 运行 lint、test、build
  - Docker 镜像构建验证

- **Deploy** (`.github/workflows/deploy.yml`)
  - 手动触发 (workflow_dispatch)
  - 通过 SSH 部署到服务器
  - 健康检查验证

### 配置 Secrets

在 GitHub 仓库 Settings → Secrets 添加：
- `SSH_HOST` - 服务器 IP
- `SSH_USER` - SSH 用户名
- `SSH_PRIVATE_KEY` - SSH 私钥
- `HEALTH_CHECK_URL` - 健康检查地址

## 日志

生产环境日志写入 `logs/YYYY-MM-DD.log`

日志级别 (LOG_LEVEL): error, warn, info, debug

```bash
# 查看日志
docker-compose logs -f server

# 实时查看日志文件
tail -f logs/$(date +%Y-%m-%d).log
```

## 文档

- [架构设计](docs/architecture.md) - 系统架构、数据流、部署
- [API 文档](docs/api.md) - 完整 API 接口说明
- [贡献指南](CONTRIBUTING.md) - 开发流程、代码规范
- [更新日志](CHANGELOG.md) - 版本变更记录

## License

MIT
