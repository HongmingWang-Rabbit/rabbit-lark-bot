# OpenClaw 集成配置指南

> **⚠️ 已废弃 (Deprecated)** — 自 2026-02-28 起，rabbit-lark-bot 已改用直接 Anthropic API 集成（tool calling 模式）。`AGENT_WEBHOOK_URL` 不再使用，`agentForwarder.js` 直接调用 Anthropic API 并通过飞书 API 回复。请参阅 [architecture.md](architecture.md#ai-对话处理agentforwarder) 了解当前架构。以下内容仅作历史参考保留。

本文档说明如何将 rabbit-lark-bot 与 OpenClaw AI Agent 对接。

---

## 架构概览

```
飞书用户
  ↓ HTTPS
Nginx (443)
  ↓ 反代
rabbit-lark-bot (3456)
  ↓ POST /lark-webhook  [HMAC: AGENT_API_KEY]
OpenClaw Gateway (18789)
  ↓ Claude 处理
  ↓ POST /api/agent/send  [Bearer: AGENT_API_KEY]
rabbit-lark-bot (3456)
  ↓ Feishu API
飞书用户收到回复
```

**关键：** `AGENT_API_KEY`（`.env`）和 `rabbitApiKey`（`openclaw.json`）**必须是同一个值**，用于双向鉴权。

---

## Step 1：生成共享密钥

```bash
openssl rand -hex 32
# 示例输出：6de1616e654190ee6492094b3aca1f8c5ea632a618f2fffba5716f793e96b6b0
```

---

## Step 2：配置 `.env`

```env
# Agent webhook 端点（Docker 容器访问宿主机 OpenClaw）
AGENT_WEBHOOK_URL=http://host.docker.internal:18789/lark-webhook

# 与 openclaw.json 中 rabbitApiKey 相同的值
AGENT_API_KEY=<your-generated-key>

# 本服务公网地址（OpenClaw 用此地址回调 /api/agent/send）
API_BASE_URL=https://your-domain.com
```

---

## Step 3：配置 `openclaw.json`

在 OpenClaw 配置文件（通常位于 `~/.openclaw/openclaw.json`）中添加：

```json
{
  "channels": {
    "lark": {
      "enabled": true,
      "rabbitApiUrl": "http://localhost:3456",
      "rabbitApiKey": "<your-generated-key>",
      "webhookPath": "/lark-webhook",
      "dmPolicy": "open"
    }
  }
}
```

> **`rabbitApiUrl`** 是 OpenClaw 调用 `/api/agent/send` 的地址。
> 如果 OpenClaw 和 rabbit-lark-bot 在同一台宿主机上，用 `http://localhost:3456`。

---

## Step 4：安装 OpenClaw Plugin

将 `packages/openclaw-plugin/` 安装到 OpenClaw：

```bash
# 方式 A：软链接（开发模式）
ln -s $(pwd)/packages/openclaw-plugin ~/.openclaw/extensions/rabbit-lark

# 方式 B：复制
cp -r packages/openclaw-plugin ~/.openclaw/extensions/rabbit-lark
```

---

## Step 5：OpenClaw Gateway 启动参数

OpenClaw Gateway **必须绑定 LAN 地址**（非纯 loopback），Docker 容器才能通过 `host.docker.internal` 访问到它：

```bash
# 正确（LAN bind，Docker 容器可访问）
openclaw gateway start --bind lan

# 错误（loopback only，Docker 无法访问）
openclaw gateway start   # 默认 bind loopback
```

如果通过 systemd 管理，修改 service 文件：
```ini
[Service]
ExecStart=/usr/bin/node /path/to/openclaw/dist/index.js gateway --port 18789 --bind lan
```

非 loopback bind 时，还需在 `openclaw.json` 中设置：
```json
{
  "gateway": {
    "controlUi": {
      "dangerouslyAllowHostHeaderOriginFallback": true
    }
  }
}
```

---

## Step 6：重启服务

```bash
# 1. 重建 server 容器（让新 AGENT_API_KEY 生效）
docker compose up -d server

# 2. 重启 OpenClaw（让新 openclaw.json 生效）
openclaw gateway restart
```

---

## Step 7：验证

```bash
# 1. 检查 agent 端点鉴权
curl -s -H "Authorization: Bearer <your-generated-key>" \
  http://localhost:3456/api/agent/status
# 期望：{"success":true,"configured":true,"webhook_configured":true}

# 2. 检查 OpenClaw 能否收到消息（发条飞书消息后看 gateway 日志）
openclaw logs

# 3. 检查回调路径（OpenClaw → /api/agent/send）
# 看 server 日志中有无 "Agent sending message" 而非 "401 Unauthorized"
docker logs rabbit-lark-server --since 5m | grep -E "agent|401"
```

---

## 常见错误

### `POST /api/agent/send 401`
OpenClaw 的 `rabbitApiKey` 与 `.env` 中的 `AGENT_API_KEY` 不一致，或 `AGENT_API_KEY` 未设置。

### `Agent forwarding failed: connect ECONNREFUSED`
OpenClaw Gateway 未启动，或 `AGENT_WEBHOOK_URL` 地址不可达。
如果在 Docker 中运行，确保 Gateway 用 `--bind lan` 启动。

### `Agent forwarding failed: Agent returned 401`
OpenClaw plugin 的 `rabbitApiKey` 未设置，导致 HMAC 签名为空，plugin 拒绝了来自 rabbit-lark-bot 的请求。

### `Agent responded: success` 但飞书没收到回复
检查 OpenClaw gateway 日志是否有模型调用错误，以及 `/api/agent/send` 的鉴权是否通过（见上）。
