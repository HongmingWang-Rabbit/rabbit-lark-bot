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

## 管理后台显示「加载失败」/ 401

### 症状
浏览器控制台显示 `GET /api/dashboard 401 Unauthorized`。

### 原因：`NEXT_PUBLIC_API_KEY` 没有在 build 时注入

Next.js 的 `NEXT_PUBLIC_*` 变量在 **`next build` 时**内联到 JS bundle 中，运行时环境变量对已构建的 bundle 无效。

**错误做法（不生效）：**
```bash
# 改了 .env 后只重启容器
docker compose restart web     # ❌ bundle 里的 key 没变
docker compose up -d web       # ❌ 镜像没重建，bundle 还是旧的
```

**正确做法：**
```bash
# 必须重建镜像
docker compose build web && docker compose up -d web   # ✅
```

同样受影响的变量：`NEXT_PUBLIC_ADMIN_PASSWORD`、`NEXT_PUBLIC_API_URL`

---

## 管理后台显示「管理后台未配置」

### 症状
进入管理后台显示「请设置环境变量 `NEXT_PUBLIC_ADMIN_PASSWORD` 后重启服务」。

### 原因
同上，`NEXT_PUBLIC_ADMIN_PASSWORD` 没有在 build 时传入，bundle 里是空字符串。

**修复：**
```bash
# 确认 .env 里有 NEXT_PUBLIC_ADMIN_PASSWORD=xxx
# 然后重建镜像
docker compose build web && docker compose up -d web
```

---

## AI Agent 收到消息但不回复（`/api/agent/send` 401）

### 症状
Server 日志显示 `Agent responded: success: true`，但随后出现：
```
WARN Unauthorized API access attempt {"path":"/agent/send"}
```
飞书没有收到回复。

### 原因：`AGENT_API_KEY` 与 `API_KEY` 是两把不同的 key

| Key | 用途 | 配置位置 |
|-----|------|---------|
| `API_KEY` | Web 管理后台 API 鉴权 | `.env` |
| `AGENT_API_KEY` | rabbit-lark-bot ↔ OpenClaw 共享密钥 | `.env` + `openclaw.json` |

OpenClaw plugin 用 `rabbitApiKey`（来自 `openclaw.json`）调用 `/api/agent/send`，  
服务器用 `AGENT_API_KEY` 验证这个回调。两边必须一致。

**修复步骤：**

1. 生成一个随机密钥：
   ```bash
   openssl rand -hex 32
   ```

2. 在 `.env` 里设置：
   ```env
   AGENT_API_KEY=<generated-key>
   ```

3. 在 OpenClaw 的 `openclaw.json` 里设置（值相同）：
   ```json
   {
     "channels": {
       "lark": {
         "rabbitApiKey": "<generated-key>"
       }
     }
   }
   ```

4. 重启服务：
   ```bash
   # 重建 server 容器（让新 env 生效）
   docker compose up -d server
   # 重启 OpenClaw gateway（让新 config 生效）
   openclaw gateway restart
   ```

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

## OpenClaw Plugin 接入检查清单

以下配置需要手动完成，代码无法自动检测：

- [ ] `openclaw.json` 中 `channels.lark.enabled: true`
- [ ] `channels.lark.rabbitApiUrl` 指向 server（Docker 内用 `http://localhost:3456`，宿主机访问容器用 `http://localhost:3456`）
- [ ] `channels.lark.rabbitApiKey` 与 `.env` 中的 `AGENT_API_KEY` 值一致
- [ ] `channels.lark.webhookPath` 默认为 `/lark-webhook`（与 `AGENT_WEBHOOK_URL` 路径一致）
- [ ] OpenClaw gateway 以 `--bind lan`（而非 loopback）启动，Docker 容器才能访问 `host.docker.internal:18789`
- [ ] OpenClaw gateway 配置 `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback: true`（非 loopback bind 时需要）
- [ ] 飞书应用 webhook URL 使用 HTTPS 域名（`https://your-domain.com/webhook/event`）

详见 [docs/setup-openclaw.md](setup-openclaw.md)。
