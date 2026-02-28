# Troubleshooting

常见问题和解决方案，基于实际部署经验整理。

---

## 飞书 Webhook 未收到消息

### 症状
用户在飞书发消息，server 日志里没有任何 `📨 Message received`。

### 原因 1：Webhook URL 配置错误
飞书要求 webhook 地址必须是 **HTTPS + 域名**，不能是裸 IP 或 HTTP。

| ❌ 错误 | ✅ 正确 |
|--------|--------|
| `http://18.x.x.x:3456/webhook/event` | `https://your-domain.com/webhook/event` |
| `http://your-domain.com/webhook/event` | `https://your-domain.com/webhook/event` |

> 端口 3456 绑定在 `127.0.0.1`（仅本地），外网无法直接访问。
> 流量路径：飞书 → HTTPS:443 → Nginx 反代 → 127.0.0.1:3456

### 原因 2：飞书暂停了事件推送
服务器重启、返回 5xx、或连续超时后，飞书会自动暂停向该 URL 推送事件。

**恢复方式：**
1. 打开 [飞书开放平台](https://open.feishu.cn/app) → 你的应用
2. 事件与回调 → 请求地址配置
3. 点「验证」重新验证 URL
4. 确认页面显示「已启用」状态

---

## 管理后台显示 401 / 无法登录

### 症状
浏览器控制台显示 `GET /api/dashboard 401 Unauthorized`，或登录后立即跳回登录页。

### 原因 1：`JWT_SECRET` 未设置
生产环境必须设置 `JWT_SECRET` 环境变量（32+ 字节随机值），否则服务端无法签发/验证 JWT。

**修复：**
```bash
# .env 中添加
JWT_SECRET=your_random_secret_at_least_32_bytes
# 重启 server
docker compose up -d server
```

### 原因 2：Session 已过期
JWT cookie 有效期为 7 天，过期后需重新登录。

### 原因 3：Cookie 未正确传递
确保浏览器没有阻止第三方 cookie，且前端请求包含 `credentials: 'include'`。

---

## AI 不回复 / AI 服务不可用

### 症状 1：飞书消息发出后没有 AI 回复
Server 日志显示 `ANTHROPIC_API_KEY not set, skipping agent forward`。

**原因：** `.env` 中未设置 `ANTHROPIC_API_KEY`。

**修复：**
```env
ANTHROPIC_API_KEY=sk-ant-xxx
```
然后重建容器：`docker compose up -d server`

### 症状 2：AI 回复 "⚠️ AI 服务暂时不可用"
Server 日志显示 `Anthropic API error`。

**可能原因：**
- API Key 无效或过期
- Anthropic API 临时不可用
- 速率限制被触发（系统限制并发 10 个 agent 调用）

### 症状 3：`/api/agent/send` 401（MCP/外部集成）

`AGENT_API_KEY` 与 `API_KEY` 是两把不同的 key：

| Key | 用途 | 配置位置 |
|-----|------|---------|
| `API_KEY` | Web 管理后台 API 鉴权 | `.env` |
| `AGENT_API_KEY` | `/api/agent/*` 端点的认证 key | `.env` |

**修复：** 确保外部调用者使用 `AGENT_API_KEY` 的值作为 Bearer token。

---

## `docker compose restart` 后新 env 变量不生效

### 症状
修改了 `.env`，执行 `docker compose restart server`，变量还是旧的。

### 原因
`docker compose restart` 只重启容器进程，**不重新解析 `.env` 做变量替换**。
容器使用的仍是上次 `up` 时生成的配置。

**正确做法：**
```bash
docker compose up -d server    # 重建容器，重新读取 .env ✅
```

验证变量是否生效：
```bash
docker exec rabbit-lark-server printenv | grep AGENT_API_KEY
```

---

## 催办任务：完成命令格式

系统支持以下两种格式，均可识别：

**正向格式（推荐）：**
```
完成 [任务名/序号] [证明链接(可选)]
完成 提交报告 https://docs.example.com/proof
完成 1
done 2
```

**自然语言格式（也支持）：**
```
test 任务完成
提交报告 完成了
第一项任务 已完成
```

如果有多个待办任务且无法匹配到唯一一项，bot 会列出任务列表让用户选择序号。
可先发「我的任务」查看当前待办列表。

---

## 用户名/邮箱显示为空

### 症状
飞书用户发过消息，但管理后台里姓名和邮箱是空的。

### 原因
获取用户详情需要飞书应用开通 Contact API 权限，且权限需要**发布新版本**后才生效。

**所需权限：**
- `contact:user.base:readonly` — 获取用户基本信息
- `contact:contact.base:readonly` — 通用联系人读取

**操作步骤：**
1. 飞书开放平台 → 权限管理 → 添加以上权限
2. 创建新版本并发布（灰度或全量）
3. 用户下次发消息时系统会自动补全信息

**手动批量补全已有用户：**
```bash
DATABASE_URL=postgres://rabbit:password@localhost:5432/rabbit_lark \
NODE_PATH=packages/server/node_modules \
node scripts/enrich-users.js
```

---

## AI 功能接入检查清单

- [ ] `.env` 中设置 `ANTHROPIC_API_KEY`（必填，缺失时 AI 功能禁用）
- [ ] `.env` 中设置 `AGENT_API_KEY`（推荐，保护 `/api/agent/*` 端点）
- [ ] 飞书应用 webhook URL 使用 HTTPS 域名（`https://your-domain.com/webhook/event`）
- [ ] 飞书应用已开通 Contact API 权限（用于用户名/邮箱解析）
- [ ] 数据库已执行 `008_add_conversation_history.sql` 迁移
- [ ] 确认 `GET /api/agent/status` 返回 `"configured": true`
