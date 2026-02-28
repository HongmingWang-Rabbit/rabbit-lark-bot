# API 文档

Base URL: `http://your-server:3456`

## 认证

### Web 管理 API (`/api/*`)

Web 管理后台使用 **JWT session cookie** 认证（`rlk_session`，httpOnly，7d 过期）。

**登录方式：**
1. **飞书 OAuth SSO**（主）— 点击"飞书账号登录" → 授权回调 → 自动设置 cookie
2. **密码登录**（备选）— `POST /api/auth/password` → 验证 `ADMIN_PASSWORD` 环境变量 → 设置 cookie

**向后兼容：** 旧的 API Key 认证方式仍然支持：
```
X-API-Key: your_api_key
# 或
Authorization: Bearer your_api_key
```
`sessionAuth` 中间件检查顺序：JWT cookie → X-API-Key / Bearer（匹配 `API_KEY` 环境变量）。

**环境行为：**
- `NODE_ENV=development` 且未设置 `REQUIRE_AUTH`：跳过认证
- `NODE_ENV=production` 且未设置 `JWT_SECRET`：拒绝启动
- 其他环境无任何认证配置：允许访问（仅开发用）

### Agent API (`/api/agent/*`)

Agent 端点使用 `agentAuth` 中间件，检查顺序：
1. **环境变量 key** — `AGENT_API_KEY` 或 `API_KEY`（SHA-256 + timingSafeEqual）
2. **DB-backed API key** — 在 `agent_api_keys` 表中查找 SHA-256 哈希（管理后台 /api-keys 页面创建）

```
Authorization: Bearer rlk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 或
X-API-Key: your_agent_api_key
```

## 限流

- API：100 请求/分钟/IP
- Webhook：200 请求/分钟/IP
- 内存上限：10,000 条目（超出时批量淘汰 ~10% 最早条目）

> 注意：限流计数器存储在进程内存中（固定窗口），多实例部署时每个实例独立计数。

---

## 健康检查

### GET /health

```json
{
  "status": "ok",
  "timestamp": "2026-02-26T10:00:00.000Z",
  "version": "1.0.0"
}
```

---

## Webhook

### POST /webhook/event

飞书事件回调，由飞书服务器调用，无需手动调用。

**认证方式：**
- 加密载荷（`encrypt` 字段）：AES-256-CBC 解密即认证（仅在 `FEISHU_ENCRYPT_KEY` 已配置时生效）
- 明文载荷：SHA-256 签名验证（`X-Lark-Signature` 头）

**URL 验证：**
```json
// 请求
{ "encrypt": "<AES加密内容>" }
// 解密后
{ "type": "url_verification", "challenge": "xxx" }
// 响应
{ "challenge": "xxx" }
```

---

## 认证端点

认证路由不需要预先认证（它们自己处理认证）。

### GET /api/auth/feishu

重定向到飞书 OAuth 授权页面。设置 CSRF state cookie（`rlk_oauth_state`，5 分钟有效）。

**前置要求：**
- `FEISHU_APP_ID` 和 `FEISHU_OAUTH_REDIRECT_URI` 环境变量已配置
- 飞书开放平台 → 安全设置 → 已添加重定向 URL

### GET /api/auth/feishu/callback

OAuth 回调，由飞书服务器重定向至此。验证 CSRF state → 换取 access_token → 获取用户信息 → 自动注册/更新用户 → 设置 JWT cookie → 重定向到 `/`。

### POST /api/auth/password

密码登录（备选方案）。

**Request Body：**
```json
{
  "password": "your_admin_password"
}
```

**Response（成功）：**
```json
{
  "success": true,
  "user": {
    "userId": "password_admin",
    "name": "管理员",
    "role": "superadmin"
  }
}
```

**错误：**
- `400` — 缺少 password
- `401` — 密码错误
- `429` — 请求过多（服务端限流：5 次/IP/分钟）
- `500` — 未配置 `ADMIN_PASSWORD` 环境变量

### GET /api/auth/me

检查当前会话状态。

**Response（已登录）：**
```json
{
  "authed": true,
  "user": {
    "userId": "user@company.com",
    "name": "张三",
    "email": "user@company.com",
    "role": "admin",
    "avatarUrl": "https://..."
  }
}
```

**Response（未登录）：**
```json
{
  "authed": false
}
```

### POST /api/auth/logout

清除 JWT session cookie。

**Response：**
```json
{ "success": true }
```

---

## API Key 管理

需要 `sessionAuth` 认证，且**必须为 admin 或 superadmin 角色**（非管理员返回 `403 Forbidden`）。

### GET /api/api-keys

获取所有 API Key 列表（不含原始 key）。

**Response：**
```json
[
  {
    "id": 1,
    "name": "MCP Prod",
    "key_prefix": "rlk_abcd",
    "created_by": "user@company.com",
    "created_at": "2026-02-28T10:00:00.000Z",
    "last_used_at": "2026-02-28T12:00:00.000Z",
    "revoked_at": null
  }
]
```

### POST /api/api-keys

创建新 API Key。返回原始 key（仅此一次）。

**Request Body：**
```json
{
  "name": "MCP Prod"
}
```

**Response（`201 Created`）：**
```json
{
  "id": 1,
  "name": "MCP Prod",
  "key_prefix": "rlk_abcd",
  "created_by": "user@company.com",
  "created_at": "2026-02-28T10:00:00.000Z",
  "key": "rlk_abcd1234abcd1234abcd1234abcd1234"
}
```

> **重要：** `key` 字段仅在创建时返回一次，之后无法再次获取。请立即复制保存。

**验证规则：**
- `name` 必填，1-100 字符

**错误：**
- `400` — 缺少 name 或超过 100 字符
- `403` — 非 admin/superadmin 角色

### DELETE /api/api-keys/:id

软撤销 API Key（设置 `revoked_at`，不删除记录）。

**Response：**
```json
{
  "success": true,
  "revoked": {
    "id": 1,
    "name": "MCP Prod",
    "key_prefix": "rlk_abcd",
    "revoked_at": "2026-02-28T14:00:00.000Z"
  }
}
```

**错误：**
- `400` — Invalid key ID
- `403` — 非 admin/superadmin 角色
- `404` — Key 不存在或已撤销

---

## Dashboard

### GET /api/dashboard

```json
{
  "stats": {
    "totalTasks": 10,
    "pendingTasks": 3,
    "completedTasks": 7,
    "adminCount": 2,
    "totalUsers": 15
  },
  "builtinEnabled": true,
  "recentActivity": [
    {
      "id": 1,
      "user_id": "ou_xxx",
      "action": "create_task",
      "target_type": "task",
      "target_id": "5",
      "details": { "title": "提交报告" },
      "created_at": "2026-02-26T10:00:00.000Z"
    }
  ]
}
```

---

## 催办任务

### GET /api/tasks

获取所有任务（按创建时间倒序，最多 100 条）。

**Response：**
```json
[
  {
    "id": 5,
    "title": "提交季度报告",
    "creator_id": "on_xxx",
    "assignee_id": "on_xxx",
    "assignee_open_id": "ou_xxx",
    "reporter_open_id": "ou_yyy",
    "deadline": "2026-03-31T16:00:00.000Z",
    "status": "pending",
    "reminder_interval_hours": 24,
    "last_reminded_at": null,
    "deadline_notified_at": null,
    "proof": null,
    "note": "请在月底前完成",
    "created_at": "2026-02-26T10:00:00.000Z",
    "completed_at": null
  }
]
```

### POST /api/tasks

创建催办任务。

**Request Body：**
```json
{
  "title": "提交季度报告",
  "targetOpenId": "ou_xxx",         // 执行人 open_id（推荐，来自 UserCombobox）
  "targetEmail": "user@company.com", // 备选：按邮箱查找执行人
  "reporterOpenId": "ou_yyy",        // 报告对象 open_id（可选）
  "deadline": "2026-03-31",          // YYYY-MM-DD（可选）
  "note": "请在月底前完成",           // 可选，最多 1000 字
  "reminderIntervalHours": 24,       // 提醒间隔小时（默认 24，0=关闭，负数自动归零）
  "creatorId": "on_xxx"             // 创建者 feishu_user_id（可选，用于审计）
}
```

**验证规则：**
- `title` 必填，最多 200 字
- `note` 最多 1000 字
- `reminderIntervalHours` 自动取整并 clamp 到 ≥ 0

**Response：**
```json
{
  "success": true,
  "task": { /* 完整任务对象 */ }
}
```

**错误：**
- `400` — 标题或目标用户未提供
- `400` — 标题超过 200 字 / 备注超过 1000 字
- `400` — 找不到目标用户（未发过飞书消息）
- `400` — Invalid task ID（非数字 ID）

### POST /api/tasks/:id/complete

标记任务完成（会触发通知报告对象）。

**Request Body：**
```json
{
  "proof": "https://example.com/report.pdf",  // 完成证明（可选）
  "userId": "on_xxx"                           // 操作人 feishu_user_id（可选，审计用）
}
```

**Response：**
```json
{
  "success": true,
  "task": { /* 更新后的任务对象 */ }
}
```

**错误：**
- `400` — Invalid task ID
- `404` — 任务不存在或已完成

### DELETE /api/tasks/:id

删除任务。

**Query Params：**
- `userId` — 操作人（可选，审计用）

**Response：**
```json
{ "success": true, "task": { /* 被删除的任务 */ } }
```

**错误：**
- `400` — Invalid task ID
- `404` — 任务不存在

---

## 用户管理

### GET /api/users

获取所有用户（按创建时间倒序）。

**Query Params：**
- `role` — 过滤角色（superadmin/admin/user）
- `limit` — 默认 100
- `offset` — 默认 0

**Response：**
```json
{
  "users": [
    {
      "id": 1,
      "userId": "ou_xxx",
      "openId": "ou_xxx",
      "feishuUserId": "on_xxx",
      "name": "张三",
      "email": null,
      "phone": null,
      "role": "user",
      "configs": { "features": {} },
      "resolvedFeatures": { "cuiban_view": true, "cuiban_complete": true },
      "createdAt": "2026-02-26T05:40:00.000Z",
      "updatedAt": "2026-02-26T07:00:00.000Z"
    }
  ]
}
```

### GET /api/users/_features

获取功能定义列表（用于管理面板功能开关 UI）。

### POST /api/users

创建或更新用户（按 userId/openId 查重）。

**Request Body：**
```json
{
  "userId": "ou_xxx",
  "openId": "ou_xxx",
  "name": "张三",
  "email": "zhangsan@company.com",
  "role": "admin"
}
```

### PATCH /api/users/:userId

更新用户信息（部分更新）。

**Request Body（任意字段）：**
```json
{
  "name": "张三",
  "email": "zhangsan@company.com",
  "phone": "138xxxxxxxx",
  "role": "admin",
  "configs": { "features": { "cuiban_create": true } }
}
```

### PATCH /api/users/:userId/features/:featureId

修改用户单个功能开关（覆盖角色默认值）。

**Request Body：**
```json
{
  "enabled": true
}
```

### DELETE /api/users/:userId

删除用户。

---

## 管理员

### GET /api/admins

### POST /api/admins

```json
{
  "userId": "ou_xxx",
  "email": "admin@company.com",
  "name": "管理员",
  "role": "admin"  // admin | superadmin
}
```

### DELETE /api/admins/:userId

---

## 系统配置

### GET /api/settings

```json
[
  { "key": "default_deadline_days", "value": 3, "description": "默认截止天数" },
  { "key": "timezone", "value": "Asia/Shanghai", "description": "时区" }
]
```

### PUT /api/settings/:key

更新配置项。仅允许以下预定义的 key：

- `enable_builtin_bot` — 启用/禁用内置催办功能
- `default_deadline_days` — 默认截止天数
- `default_reminder_interval_hours` — 默认提醒间隔
- `welcome_message` — 欢迎消息
- `max_tasks_per_user` — 每用户最大任务数

**Request Body：**
```json
{
  "value": 5,
  "description": "更新后的描述"
}
```

**错误：**
- `400` — 未知的 setting key

---

## 审计日志

### GET /api/audit

**Query Params：**
- `limit` — 默认 50，最大 500
- `offset` — 默认 0
- `userId` — 按用户过滤
- `action` — 按操作类型过滤

**Action 类型：**
`create_task` / `complete_task` / `delete_task` / `add_admin` / `remove_admin` / `update_settings` / `create_api_key` / `revoke_api_key`

---

## AI Agent API

所有 `/api/agent/*` 端点使用 `AGENT_API_KEY` 认证（与管理 API 的 `API_KEY` 分开）。

### GET /api/agent/status

检查 Agent 配置状态。

**Response：**
```json
{
  "success": true,
  "configured": true,
  "model": "claude-haiku-4-5-20251001",
  "maxHistoryMessages": 20,
  "maxToolRounds": 5
}
```

### POST /api/agent/send

向飞书用户或群聊发送消息（外部集成 / MCP 用）。

**Request Body：**
```json
{
  "chat_id": "oc_xxx",          // 必填
  "content": "你好！",           // 必填
  "msg_type": "text",            // text（默认）| interactive
  "reply_to_message_id": "om_xxx" // 可选，线程回复
}
```

### POST /api/agent/reply

回复特定消息（线程内）。

**Request Body：**
```json
{
  "message_id": "om_xxx",
  "content": "回复内容"
}
```

### POST /api/agent/react

添加表情回应。

**Request Body：**
```json
{
  "message_id": "om_xxx",
  "emoji": "THUMBSUP"
}
```

### GET /api/agent/tasks

获取用户待办催办任务列表（按 open_id）。

**Query Params：**
- `open_id` — 用户 open_id（必填）

**Response：**
```json
{
  "success": true,
  "tasks": [
    {
      "id": 1,
      "title": "提交报告",
      "deadline": "2026-03-01T00:00:00.000Z",
      "status": "pending"
    }
  ]
}
```

### POST /api/agent/tasks

创建催办任务（AI 驱动，创建后自动 DM 通知被催办人）。

**Request Body：**
```json
{
  "title": "提交季度报告",       // 必填
  "target_open_id": "ou_xxx",  // 必填，被催办人的 open_id
  "reporter_open_id": "ou_yyy", // 可选，完成时通知的报告人
  "deadline": "2026-03-31",    // YYYY-MM-DD（可选）
  "note": "备注"               // 可选
}
```

**Response：**
```json
{
  "success": true,
  "task": { /* 完整任务对象 */ }
}
```

**错误：**
- `400` — 缺少 title 或 target_open_id
- `400` — 找不到 target_open_id 对应的用户

### POST /api/agent/tasks/:id/complete

标记任务完成。

**Request Body：**
```json
{
  "proof": "https://example.com/proof.pdf",  // 可选
  "user_open_id": "ou_xxx"                   // 可选，完成人 open_id（审计用）
}
```

**Response：**
```json
{
  "success": true,
  "task": { /* 更新后的任务对象 */ }
}
```

**错误：**
- `400` — Invalid task ID
- `403` — 非任务 assignee 尝试完成（仅当提供 `user_open_id` 时校验）
- `404` — 任务不存在或已完成

---

## 错误格式

```json
{ "error": "错误描述信息" }
```

生产环境（`NODE_ENV=production`）中错误消息会被替换为通用描述，不暴露内部实现细节。

| 状态码 | 含义 |
|--------|------|
| `400` | 请求参数错误 |
| `401` | 未授权（缺少 API Key） |
| `404` | 资源不存在 |
| `429` | 请求过多（被限流） |
| `500` | 服务器内部错误 |
| `503` | 数据库不可用 |

---

## 飞书机器人命令参考

### 关键字命令（直接处理，不经过 AI）

| 消息 | 触发意图 | 响应 | 权限 |
|------|---------|------|------|
| `hi` / `你好` / `帮助` 等 | greeting | 动态功能菜单 | 全员 |
| `菜单` / `功能` | menu | 功能菜单 | 全员 |
| `我的任务` / `任务列表` | cuiban_view | 待办任务列表 | `cuiban_view` |
| `完成 [N/名称] [URL]` | cuiban_complete | 标记完成，可附证明 | `cuiban_complete` |
| 数字（任务选择流程中） | — | 选择多任务之一 | — |
| `/add 任务名 邮箱/姓名 [日期]` | cuiban_create | 创建任务，通知执行人 | `cuiban_create` |

### 自然语言（转发给 AI，Anthropic tool calling 处理）

| 示例消息 | AI 行为 |
|---------|---------|
| `给王泓铭创建一个催办，今天把ST6数据给到我` | 匹配注册用户 → `create_task` |
| `帮我查一下我的待办` | `list_tasks` → 返回列表 |
| `把任务1完成了` | `list_tasks` → `complete_task`（验证归属） |
| `王鸿铭的任务` | 模糊匹配 → 询问确认（王泓铭？）再执行 |

### 说明

- 无任何功能权限的用户收到"请联系管理员开通权限"
- 自然语言命令由 Claude 解析，名字不完全匹配时先询问确认再操作
- `/add` 命令支持邮箱、feishu_user_id、姓名（模糊）三种查找方式
- 用户只能通过 AI 完成分配给自己的任务（`complete_task` 有归属校验）
