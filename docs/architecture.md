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
│         └──→ 其他           →  agentForwarder → AI Agent            │
│                                    └──→ POST AGENT_WEBHOOK_URL       │
└──────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    PostgreSQL                     AI Agent
  (users/tasks/                (OpenClaw/其他)
   sessions/logs)               POST /api/agent/send → 飞书回复
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
│   ├── reminder.js        # 催办任务：CRUD + 提醒 cron
│   └── agentForwarder.js  # 消息转发给 AI Agent
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
│   ├── auth.js            # API Key 认证
│   └── rateLimit.js       # 限流（API 100/min，Webhook 200/min）
└── utils/
    ├── intentDetector.js  # 消息意图分类
    ├── menuBuilder.js     # 动态权限菜单
    └── logger.js          # 结构化日志（winston）
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
│   └── UserCombobox.tsx    # 用户搜索下拉（按姓名/邮箱过滤，返回 openId）
└── lib/
    └── api.ts              # API 客户端 + TypeScript 类型
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
  rabbit-lark-db:     # PostgreSQL 15
  rabbit-lark-server: # Express (port 3456)
  rabbit-lark-web:    # Next.js standalone (port 3000)
```

Server 容器通过 `extra_hosts: host.docker.internal` 访问宿主机上的 AI Agent（如 OpenClaw Gateway）。

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
```

---

## 安全

| 层面 | 实现 |
|------|------|
| Webhook 解密 | AES-256-CBC，key = SHA256(FEISHU_ENCRYPT_KEY) |
| 事件去重 | 内存 Map，event_id，5 分钟 TTL |
| API 鉴权 | API_KEY via X-API-Key 或 Authorization: Bearer |
| 限流 | API 100/min，Webhook 200/min（express-rate-limit） |
| 权限检查 | resolveFeatures() 在每条消息处理前执行 |
