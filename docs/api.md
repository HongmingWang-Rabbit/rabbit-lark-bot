# API 文档

Base URL: `http://your-server:3456`

## 认证

```
X-API-Key: your_api_key
# 或
Authorization: Bearer your_api_key
```

未设置 `API_KEY` 环境变量时，API 处于未保护状态（仅用于开发）。

## 限流

- API：100 请求/分钟/IP
- Webhook：200 请求/分钟/IP

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
  "note": "请在月底前完成",           // 可选
  "reminderIntervalHours": 24,       // 提醒间隔小时（默认 24，0=关闭）
  "creatorId": "on_xxx"             // 创建者 feishu_user_id（可选，用于审计）
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
- `400` — 标题或目标用户未提供
- `400` — 找不到目标用户（未发过飞书消息）

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
- `404` — 任务不存在或已完成

### DELETE /api/tasks/:id

删除任务。

**Request Body：**
```json
{ "userId": "on_xxx" }
```

**Response：**
```json
{ "success": true, "task": { /* 被删除的任务 */ } }
```

**错误：**
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
      "name": "王泓铭",
      "email": null,
      "phone": null,
      "role": "user",
      "configs": { "features": {} },
      "createdAt": "2026-02-26T05:40:00.000Z",
      "updatedAt": "2026-02-26T07:00:00.000Z"
    }
  ]
}
```

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
  "role": "admin"
}
```

### PATCH /api/users/:userId/features

修改用户功能开关（覆盖角色默认值）。

**Request Body：**
```json
{
  "feature": "cuiban_create",
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
  { "key": "timezone", "value": "Asia/Shanghai", "description": "时区" },
  { "key": "features", "value": { "cuiban": { "enabled": true } }, "description": "功能开关" }
]
```

### PUT /api/settings/:key

```json
{
  "value": 5,
  "description": "更新后的描述"
}
```

---

## 审计日志

### GET /api/audit

**Query Params：**
- `limit` — 默认 50
- `offset` — 默认 0
- `userId` — 按用户过滤
- `action` — 按操作类型过滤

**Action 类型：**
`create_task` / `complete_task` / `delete_task` / `add_admin` / `remove_admin` / `update_settings`

---

## AI Agent API

### GET /api/agent/status

检查 Agent 配置状态。

### POST /api/agent/send

AI Agent 回复用户。

**Request Body：**
```json
{
  "chat_id": "oc_xxx",          // 必填（或 open_id）
  "open_id": "ou_xxx",          // 必填（或 chat_id）
  "content": "你好！",           // 回复内容
  "message_id": "om_xxx",       // 可选，用于线程回复
  "msg_type": "text"            // text（默认）
}
```

### POST /api/agent/reply

回复特定消息（线程内）。

### POST /api/agent/react

添加表情回应。

---

## 错误格式

```json
{ "error": "错误描述信息" }
```

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

### 任意用户

| 消息 | 触发意图 | 响应 |
|------|---------|------|
| `hi` / `你好` / `帮助` | greeting | 返回动态功能菜单 |
| `菜单` / `功能` | menu | 返回功能菜单 |
| `我的任务` / `任务列表` | cuiban_view | 待办任务列表 |
| `完成 [N/名称] [URL]` | cuiban_complete | 标记完成，可附证明 |
| 数字（选择流程中） | — | 选择多任务之一 |

### admin+

| 消息 | 触发意图 | 响应 |
|------|---------|------|
| `/add 任务名 邮箱/姓名 [日期]` | cuiban_create | 创建任务，通知执行人 |

### 说明

- 非命令消息转发给 AI Agent
- 无任何功能权限的用户收到"请联系管理员开通权限"
- `/add` 支持邮箱、feishu_user_id、姓名（模糊）三种查找方式
