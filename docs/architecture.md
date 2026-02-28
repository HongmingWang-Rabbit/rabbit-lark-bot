# 架构设计

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Rabbit Lark Server                           │
│                                                                      │
│  POST /webhook/event                                                 │
│         │                                                            │
│         ▼                                                            │
│  ① 解密（AES-256-CBC）+ 去重（event_id）                             │
│         │                                                            │
│         ▼                                                            │
│  ② 用户自动注册 / 信息补全                                           │
│     findByOpenId → autoProvision → enrich（Contact API）             │
│         │                                                            │
│         ▼                                                            │
│  ③ 意图检测（intentDetector）                                        │
│     greeting │ menu │ cuiban_view │ cuiban_complete │ cuiban_create  │
│         │                                                            │
│         ▼                                                            │
│  ④ 权限检查（resolveFeatures）                                       │
│         │                                                            │
│         ├──→ greeting/menu  →  buildMenu() → 飞书 DM                │
│         │                                                            │
│         ├──→ cuiban_*       →  handleCuibanCommand()                │
│         │      │                   │                                 │
│         │      │              DB sessions（多步选择）                │
│         │      │              reminder.js（任务 CRUD）               │
│         │      └──→ 飞书 DM（执行人 + 报告人）                       │
│         │                                                            │
│         └──→ 其他           →  agentForwarder → Anthropic API        │
│                                    ├── system prompt（用户/权限/注册用户列表/日期）│
│                                    ├── tool calling: list_tasks /       │
│                                    │   create_task / complete_task      │
│                                    ├── conversation history (PostgreSQL) │
│                                    └── feishu.sendMessage() 直接回复    │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
    PostgreSQL
  (users/tasks/sessions/
   audit_logs/conversation_history)
```

## 包结构

### packages/server

```
src/
├── index.js               # 入口，启动定时任务（reminder cron + session cleanup）
├── routes/
│   ├── webhook.js         # 飞书事件处理，意图路由
│   ├── api.js             # 管理 API（tasks/admins/settings/audit）
│   ├── agent.js           # AI Agent 回复 API
│   └── users.js           # 用户管理 API
├── services/
│   ├── reminder.js        # 催办任务：CRUD + 提醒 cron（make_interval 参数化）
│   ├── agentForwarder.js  # 直接调用 Anthropic API（singleton client + tool calling + 对话历史 + 并发信号量 max 10）
│   └── cuibanHandler.js   # 催办命令路由（view/complete/create）
├── db/
│   ├── pool.js            # pg 连接池
│   ├── users.js           # 用户 CRUD + autoProvision
│   ├── sessions.js        # DB-backed 会话（5分钟 TTL）
│   └── index.js           # admins / settings / audit helpers
├── features/
│   └── index.js           # 功能注册表 + resolveFeatures()
├── feishu/
│   └── client.js          # Feishu REST API（消息/联系人/多维表格）
├── middleware/
│   ├── auth.js            # feishuWebhookAuth（签名+解密）+ apiAuth（SHA-256 + timingSafeEqual）
│   └── rateLimit.js       # 内存限流（API 100/min，Webhook 200/min，10k cap，批量淘汰 ~10%，单实例）
└── utils/
    ├── intentDetector.js  # 消息意图分类
    ├── menuBuilder.js     # 动态权限菜单
    ├── logger.js          # 自定义结构化日志（文件轮转 + stdout）
    ├── safeError.js       # 生产环境安全错误消息
    └── validateEnv.js     # 启动时环境变量校验
```

### packages/web

```
src/
├── app/
│   ├── page.tsx            # Dashboard（统计 + 近期活动）
│   ├── tasks/page.tsx      # 催办任务管理
│   ├── users/page.tsx      # 用户管理（角色/功能/信息）
│   └── layout.tsx / NavBar.tsx
├── components/
│   ├── UserCombobox.tsx    # 用户搜索下拉（按姓名/邮箱过滤，返回 openId）
│   └── StatusStates.tsx    # 共享加载/错误/空状态组件
└── lib/
    ├── api.ts              # API 客户端 + TypeScript 类型 + SWR_KEYS
    └── auth.tsx            # 客户端密码认证（AuthProvider + LoginScreen）
```

---

## 数据库 Schema

### users

```sql
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    user_id         VARCHAR(64) UNIQUE NOT NULL, -- canonical ID（email 或 open_id）
    open_id         VARCHAR(64),                  -- 飞书 open_id（ou_xxx）
    feishu_user_id  TEXT,                         -- union_id（on_xxx）作为 feishu_user_id
    name            VARCHAR(100),
    email           VARCHAR(255),
    phone           VARCHAR(50),
    role            VARCHAR(20) NOT NULL DEFAULT 'user', -- superadmin/admin/user
    configs         JSONB NOT NULL DEFAULT '{}',  -- 每用户功能覆盖
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);
```

### tasks

```sql
CREATE TABLE tasks (
    id                      SERIAL PRIMARY KEY,
    title                   TEXT NOT NULL,
    creator_id              VARCHAR(255),          -- 创建者 feishu_user_id
    assignee_id             VARCHAR(255) NOT NULL, -- 执行人 feishu_user_id 或 open_id
    assignee_open_id        VARCHAR(255),          -- 执行人 open_id（发消息用）
    reporter_open_id        VARCHAR(255),          -- 报告对象 open_id（完成/逾期时通知）
    deadline                TIMESTAMPTZ,
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | completed
    reminder_interval_hours INTEGER NOT NULL DEFAULT 24,  -- 提醒间隔（0=关闭）
    last_reminded_at        TIMESTAMPTZ,           -- 上次定时提醒时间
    deadline_notified_at    TIMESTAMPTZ,           -- 截止逾期一次性通报时间
    proof                   TEXT,                  -- 完成证明（URL 或说明）
    note                    TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);
```

### user_sessions

```sql
CREATE TABLE user_sessions (
    id          SERIAL PRIMARY KEY,
    session_key VARCHAR(255) NOT NULL UNIQUE, -- openId 或 senderId
    data        JSONB NOT NULL,               -- 会话数据（tasks/proof/step）
    expires_at  TIMESTAMPTZ NOT NULL,         -- TTL 5 分钟
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### conversation_history

```sql
CREATE TABLE conversation_history (
    id          SERIAL PRIMARY KEY,
    chat_id     TEXT NOT NULL,        -- 飞书 chat_id，多轮对话的 key
    role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content     JSONB NOT NULL,       -- 字符串（普通消息）或块数组（tool 结果）
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_conv_history_chat ON conversation_history(chat_id, created_at DESC);
```

每个 chat_id 最多保留 20 条历史（通过原子 CTE 在 INSERT 时自动删除旧记录），用于给 Claude 提供多轮对话上下文。Schema 通过 `db/migrations/008_add_conversation_history.sql` 创建。

### settings / audit_logs / admins

```sql
CREATE TABLE settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(64),
    action      VARCHAR(50) NOT NULL,  -- create_task/complete_task/delete_task...
    target_type VARCHAR(50),
    target_id   VARCHAR(100),
    details     JSONB,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE admins (  -- 遗留表，向后兼容
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(64) UNIQUE,
    email       VARCHAR(255) UNIQUE,
    name        VARCHAR(100),
    role        VARCHAR(20) DEFAULT 'admin',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
```

---

## 权限系统

```
用户发消息
    │
    ▼
resolveFeatures(user)
    │
    ├── 读取 user.configs.features（每用户覆盖）
    │       { cuiban_create: true, ... }
    │
    └── 合并角色默认值
            user:        { cuiban_view, cuiban_complete }
            admin:       + cuiban_create, history, user_manage
            superadmin:  全部
    │
    ▼
resolved = { cuiban_view: true, cuiban_create: false, ... }
```

功能覆盖存储在 `users.configs.features`（JSONB），可在管理后台对每个用户单独开关，覆盖角色默认值。

---

## 催办任务流程

### 创建

```
/add 任务名 邮箱/姓名 [截止日期]
    │
    ▼
webhook.js → handleCuibanCommand (cuiban_create)
    │
    ├── 查找执行人（邮箱 → feishu_user_id → 姓名模糊匹配）
    │
    ├── reminder.createTask({ title, assigneeId, assigneeOpenId,
    │                         reporterOpenId, deadline, reminderIntervalHours })
    │       └── INSERT INTO tasks
    │
    └── feishu.sendMessage(assigneeOpenId, "你收到一个新催办任务")
```

### 提醒 Cron（每 15 分钟）

```
sendPendingReminders()
    │
    ├── Part 1: 截止逾期一次性通报
    │   SELECT * FROM tasks
    │   WHERE status='pending' AND deadline < NOW() AND deadline_notified_at IS NULL
    │       ├── DM 执行人：🚨 任务已逾期
    │       ├── DM 报告人：📢 催办任务逾期通报
    │       └── UPDATE deadline_notified_at = NOW()
    │
    └── Part 2: 定时提醒（interval-based）
        SELECT * FROM tasks
        WHERE status='pending'
          AND reminder_interval_hours > 0
          AND NOW() >= COALESCE(last_reminded_at, created_at) + interval
            └── DM 执行人：⏰ 催办提醒（逾期时加 ⚠️）
                UPDATE last_reminded_at = NOW()
```

### 完成

```
用户发「完成 [N/名称] [证明URL]」
    │
    ├── 单个任务 → 直接完成
    ├── 多个任务 → 列表选择（会话存入 user_sessions）
    │
    ├── reminder.completeTask(taskId, proof, userId, completerName)
    │       ├── UPDATE tasks SET status='completed'
    │       └── DM 报告人：✅ 催办任务已完成 + 完成人 + 时间 + 证明
    │
    └── 回复执行人：✅ 已完成任务「xxx」
```

---

## AI 对话处理（agentForwarder）

非命令消息（`intent = unknown`）进入 `agentForwarder.forwardToOwnerAgent()`，直接调用 Anthropic API：

```
用户消息（自然语言）
    │
    ├── 加载 PostgreSQL 对话历史（最近 20 条）
    │
    ├── 构建 System Prompt
    │       ├── 当前日期（今天/明天 YYYY-MM-DD）
    │       ├── 当前用户（姓名 / open_id / 角色 / 已开通功能）
    │       ├── 系统注册用户列表（供名字匹配/open_id 查找）
    │       └── 工具使用规则（名字模糊匹配 → 先确认）
    │
    ├── 调用 Anthropic API（claude-haiku-4-5，max_tokens=1024）
    │       └── tools: list_tasks / create_task / complete_task
    │
    └── Agentic Loop（最多 5 轮）
            │
            ├── stop_reason = end_turn  → 发送文本回复 → 存历史 → 结束
            │
            └── stop_reason = tool_use → executeTool()
                    ├── list_tasks      → reminderService.getUserPendingTasks()
                    ├── create_task     → reminderService.createTask() + 飞书 DM 通知
                    └── complete_task   → 校验归属 → reminderService.completeTask()
```

### 工具说明

| 工具 | 描述 | 必填参数 |
|------|------|---------|
| `list_tasks` | 获取用户待办任务列表 | `open_id` |
| `create_task` | 创建催办任务（自动 DM 通知被催办人） | `title`, `target_open_id`, `deadline` |
| `complete_task` | 标记任务完成（仅限本人任务） | `task_id` |

### 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key（必填，缺失时 AI 功能禁用） |

模型：`claude-haiku-4-5-20251001`（速度快，成本低）

---

## 用户自动注册

```
飞书消息到达
    │
    ├── findByOpenId(openId)         → 已存在？
    │       ├── 存在且信息完整        → 直接使用
    │       └── 存在但缺信息/新用户   → resolveUserInfo
    │
    ├── resolveUserInfo(openId, 'open_id')
    │       └── GET /contact/v3/users/{openId}
    │               需要权限：contact:contact.base:readonly
    │               返回：name, open_id, union_id（union_id 作为 feishu_user_id）
    │
    └── autoProvision({ openId, name, email, feishuUserId: union_id })
            1. findByOpenId    → 已存在 → enrich（填补缺失字段）
            2. findByEmail     → 预置用户 → 关联飞书身份
            3. findByFeishuId  → 之前无邮箱注册 → 更新
            4. 全新用户        → INSERT（role: 'user'）
```

---

## 部署

### Docker Compose

```yaml
services:
  postgres:            # PostgreSQL 16-alpine，health check via pg_isready
  server:              # Express (port 3456)，NODE_ENV=production，health check via /health
  web:                 # Next.js standalone (port 3000)，depends_on server healthy
```

- 所有端口绑定 `127.0.0.1`（不暴露到公网）
- `POSTGRES_PASSWORD` 必须在 `.env` 中设置（`${VAR:?}` 语法，缺失时 compose 启动失败）
- Server 容器通过 `extra_hosts: host.docker.internal` 访问宿主机上的 AI Agent
- 服务间通过 `condition: service_healthy` 确保启动顺序
- Server 环境变量：`DATABASE_URL`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ENCRYPT_KEY`, `API_KEY`, `CORS_ORIGIN`, `ANTHROPIC_API_KEY`, `AGENT_API_KEY`, `ENABLE_BUILTIN_BOT`, `API_BASE_URL`, `LOG_LEVEL`
  - `ANTHROPIC_API_KEY` — 必填（缺失时 AI 功能禁用，仅关键字命令可用）
  - `AGENT_API_KEY` — `/api/agent/*` 端点的认证 key（独立于 API_KEY）
  - ~~`AGENT_WEBHOOK_URL`~~ — 已废弃，agentForwarder 不再转发消息到外部 agent
- Web 构建参数：`NEXT_PUBLIC_ADMIN_PASSWORD`, `NEXT_PUBLIC_API_KEY`（通过 Docker build args 注入，因为 Next.js `NEXT_PUBLIC_*` 变量在构建时内联）

### 数据库迁移

迁移按编号顺序执行，生产环境每次部署后手动 apply：

```
001_add_users.sql              用户表
002_add_tasks.sql              催办任务表
003_add_phone_to_users.sql     手机号字段
004_add_reporter_to_tasks.sql  报告对象
005_add_reminder_interval.sql  提醒间隔 + last_reminded_at
006_add_user_sessions.sql      DB 持久化会话
007_add_deadline_notified_at.sql  截止逾期一次性通报字段
008_add_conversation_history.sql  AI 对话历史表（从 runtime DDL 迁移）
```

---

## 安全

| 层面 | 实现 |
|------|------|
| Webhook 签名 | SHA-256 签名验证基于原始请求 body 字节（`express.json({ verify })` 保留 raw body Buffer）；仅在 FEISHU_ENCRYPT_KEY 已配置时启用 |
| Webhook 解密 | AES-256-CBC，key = SHA256(FEISHU_ENCRYPT_KEY)；加密体跳过签名验证（解密本身即认证） |
| 事件去重 | 内存 Map，event_id，5 分钟 TTL（单实例，多实例无法共享） |
| API 鉴权 | SHA-256 哈希 + `crypto.timingSafeEqual`，防止长度和时序侧信道；未设 API_KEY 时仅 `NODE_ENV=development` 放行 |
| Body 大小限制 | `express.json({ limit: '1mb' })` 防止超大 payload |
| 限流 | 自定义内存 rate limiter：API 100/min，Webhook 200/min，上限 10,000 条目（超限时批量淘汰 ~10%）；单实例，多实例阈值 = N 倍 |
| 设置白名单 | `PUT /settings/:key` 仅接受预定义 key（`VALID_SETTING_KEYS`），防止任意键注入 |
| 角色验证 | 用户创建/更新时验证 role 值；admin 表验证 admin 角色值 |
| 权限检查 | resolveFeatures() 在每条消息处理前执行 |
| 错误屏蔽 | 生产环境（`NODE_ENV=production`）错误响应替换为通用描述，不暴露内部细节 |
| 日志安全 | 用户 ID 不包含在错误消息中 |
| CORS | 可通过 `CORS_ORIGIN` 限制允许的跨域来源，默认 `*` |
| 登录保护 | Web 管理后台连续 5 次密码错误后锁定 1 分钟 |
| Agent 并发 | `agentForwarder` 限制最多 10 个并发 Anthropic API 调用（信号量模式），防止负载下耗尽连接或触发速率限制 |
| Agent 任务归属 | `complete_task` 工具和 `/api/agent/tasks/:id/complete` 均校验调用者是否为任务的 assignee |
