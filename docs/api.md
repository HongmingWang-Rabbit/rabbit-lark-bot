# API 文档

Base URL: `http://localhost:3456`

## 认证

API 支持两种认证方式：

### 1. API Key (推荐)
```
X-API-Key: your_api_key
```

### 2. Bearer Token
```
Authorization: Bearer your_api_key
```

**注意：** 如果未配置 `API_KEY` 环境变量，API 将处于未保护状态（仅建议开发环境）。

## Rate Limiting

- API 接口：100 请求/分钟
- Webhook：200 请求/分钟

响应头：
- `X-RateLimit-Limit` - 窗口内最大请求数
- `X-RateLimit-Remaining` - 剩余请求数
- `Retry-After` - 被限流后需等待秒数

---

## 健康检查

### GET /health

检查服务状态

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-25T21:00:00.000Z",
  "version": "1.0.0"
}
```

---

## Dashboard

### GET /api/dashboard

获取仪表盘统计数据

**Response:**
```json
{
  "stats": {
    "totalTasks": 10,
    "pendingTasks": 3,
    "completedTasks": 7,
    "adminCount": 2
  },
  "recentActivity": [
    {
      "id": 1,
      "user_id": "ou_xxx",
      "action": "create_task",
      "target_type": "task",
      "target_id": "recXXX",
      "details": {},
      "created_at": "2026-02-25T21:00:00.000Z"
    }
  ]
}
```

---

## Tasks 任务

### GET /api/tasks

获取所有任务列表

**Response:**
```json
[
  {
    "id": "recXXX",
    "name": "提交周报",
    "target": "张三",
    "status": "待办",
    "deadline": 1740000000000,
    "proof": null,
    "note": "",
    "createdAt": 1739900000000
  }
]
```

### POST /api/tasks

创建新任务

**Request Body:**
```json
{
  "taskName": "提交周报",
  "targetEmail": "zhangsan@company.com",
  "deadline": "2026-03-01",
  "note": "本周五前"
}
```

**Response:**
```json
{
  "success": true,
  "record": {
    "record_id": "recXXX",
    "fields": { ... }
  }
}
```

### POST /api/tasks/:id/complete

标记任务完成

**Request Body:**
```json
{
  "proof": "https://example.com/proof.pdf",
  "userId": "ou_xxx"
}
```

**Response:**
```json
{
  "success": true
}
```

### DELETE /api/tasks/:id

删除任务

**Request Body:**
```json
{
  "userId": "ou_xxx"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Admins 管理员

### GET /api/admins

获取管理员列表

**Response:**
```json
[
  {
    "id": 1,
    "user_id": "ou_xxx",
    "email": "admin@company.com",
    "name": "管理员",
    "role": "admin",
    "created_at": "2026-02-25T21:00:00.000Z",
    "updated_at": "2026-02-25T21:00:00.000Z"
  }
]
```

### POST /api/admins

添加管理员

**Request Body:**
```json
{
  "userId": "ou_xxx",
  "email": "admin@company.com",
  "name": "管理员",
  "role": "admin"
}
```

**Response:**
```json
{
  "id": 1,
  "user_id": "ou_xxx",
  "email": "admin@company.com",
  "name": "管理员",
  "role": "admin",
  "created_at": "2026-02-25T21:00:00.000Z"
}
```

### DELETE /api/admins/:userId

移除管理员

**Response:**
```json
{
  "success": true,
  "removed": { ... }
}
```

---

## Settings 配置

### GET /api/settings

获取所有配置

**Response:**
```json
[
  {
    "key": "default_deadline_days",
    "value": 3,
    "description": "默认截止天数"
  },
  {
    "key": "timezone",
    "value": "Asia/Shanghai",
    "description": "时区"
  }
]
```

### PUT /api/settings/:key

更新配置

**Request Body:**
```json
{
  "value": 5,
  "description": "更新后的描述"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Audit 审计日志

### GET /api/audit

获取审计日志

**Query Parameters:**
- `limit` (number) - 返回数量，默认 50
- `offset` (number) - 偏移量，默认 0
- `userId` (string) - 按用户过滤
- `action` (string) - 按操作类型过滤

**Response:**
```json
[
  {
    "id": 1,
    "user_id": "ou_xxx",
    "action": "create_task",
    "target_type": "task",
    "target_id": "recXXX",
    "details": { "taskName": "提交周报" },
    "created_at": "2026-02-25T21:00:00.000Z"
  }
]
```

---

## Webhook

### POST /webhook/event

飞书事件回调地址

用于接收飞书推送的消息事件。

**URL 验证请求:**
```json
{
  "type": "url_verification",
  "challenge": "xxx"
}
```

**响应:**
```json
{
  "challenge": "xxx"
}
```

**消息事件:**
```json
{
  "header": {
    "event_type": "im.message.receive_v1"
  },
  "event": {
    "message": {
      "message_type": "text",
      "content": "{\"text\":\"任务\"}"
    },
    "sender": {
      "sender_id": {
        "user_id": "ou_xxx"
      }
    }
  }
}
```

---

## 错误响应

所有 API 在出错时返回统一格式：

```json
{
  "error": "错误描述信息"
}
```

HTTP 状态码：
- `400` - 请求参数错误
- `401` - 未授权
- `404` - 资源不存在
- `500` - 服务器内部错误
