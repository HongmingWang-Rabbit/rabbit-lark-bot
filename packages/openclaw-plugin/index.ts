/**
 * rabbit-lark — OpenClaw channel plugin
 *
 * Receives Feishu/Lark messages forwarded by rabbit-lark-bot and routes them
 * to the OpenClaw agent. Agent replies are sent back via rabbit-lark-bot's
 * /api/agent/send endpoint.
 *
 * Config (under channels.lark):
 *   rabbitApiUrl  — base URL of your rabbit-lark-bot server (e.g. http://localhost:3456)
 *   rabbitApiKey  — shared secret for HMAC verification + outbound auth (optional)
 *   webhookPath   — HTTP path to receive inbound webhooks (default: /lark-webhook)
 *   dmPolicy      — "open" | "pairing" | "allowlist" (default: "open")
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ChannelPlugin,
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
} from "openclaw/plugin-sdk";
import {
  createNormalizedOutboundDeliverer,
  createReplyPrefixOptions,
} from "openclaw/plugin-sdk";

const CHANNEL_ID = "lark";
const DEFAULT_WEBHOOK_PATH = "/lark-webhook";

// Module-level state
let _runtime: PluginRuntime | null = null;
let _currentCfg: OpenClawConfig | null = null;

function getRuntime(): PluginRuntime {
  if (!_runtime) throw new Error("[rabbit-lark] runtime not initialized");
  return _runtime;
}

function getLarkCfg(cfg: OpenClawConfig): Record<string, unknown> {
  return ((cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID] ?? {}) as Record<
    string,
    unknown
  >;
}

// ---------------------------------------------------------------------------
// Inbound payload types (rabbit-lark-bot v1 schema)
// ---------------------------------------------------------------------------

interface RabbitLarkUser {
  id?: string;
  open_id?: string;
  union_id?: string;
  type?: string;
}

interface RabbitLarkContent {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface RabbitLarkUserContext {
  userId?: string;
  openId?: string;
  name?: string;
  role?: string;
  allowedFeatures?: Record<string, boolean>;
}

interface RabbitLarkPayload {
  event?: string;
  message_id?: string;
  chat_id?: string;
  chat_type?: "p2p" | "group";
  user?: RabbitLarkUser;
  content?: RabbitLarkContent;
  timestamp?: number;
  reply_via?: { api?: string; mcp?: string };
  source?: { bridge?: string; platform?: string; version?: string };
  userContext?: RabbitLarkUserContext;
  _raw?: unknown;
}

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

function verifySignature(body: string, signature: string, secret: string): boolean {
  try {
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve reply API endpoint
// ---------------------------------------------------------------------------

function resolveReplyApiUrl(payload: RabbitLarkPayload, larkCfg: Record<string, unknown>): string | undefined {
  // Prefer explicit config (more stable than dynamic reply_via)
  if (larkCfg.rabbitApiUrl) {
    return `${larkCfg.rabbitApiUrl}/api/agent/send`;
  }
  // Fall back to dynamic reply_via.api from payload
  return payload.reply_via?.api;
}

// ---------------------------------------------------------------------------
// Build human-readable sender label
// ---------------------------------------------------------------------------

function senderLabel(user: RabbitLarkUser | undefined, chatType: "p2p" | "group" | undefined): string {
  if (!user) return "unknown";
  const id = user.id ?? user.open_id ?? "unknown";
  // In group chats, prefix with "user:" so the agent knows it's a person, not a system message
  return chatType === "group" ? `user:${id}` : id;
}

// ---------------------------------------------------------------------------
// Inbound message processing
// ---------------------------------------------------------------------------

async function processInbound(payload: RabbitLarkPayload, rawBody: string): Promise<void> {
  const core = getRuntime();
  const cfg = _currentCfg;
  if (!cfg) {
    console.warn("[rabbit-lark] no config, dropping message");
    return;
  }

  const larkCfg = getLarkCfg(cfg);
  const chatId = payload.chat_id;
  const text = payload.content?.text?.trim();

  if (!chatId || !text) {
    console.warn("[rabbit-lark] missing chat_id or text, dropping");
    return;
  }

  // Verify HMAC if a shared secret is configured
  const apiKey = larkCfg.rabbitApiKey as string | undefined;

  // Resolve chat type — use explicit field, fall back to oc_ prefix heuristic
  const chatType = payload.chat_type ?? (chatId.startsWith("oc_") ? "group" : "p2p");
  const isGroup = chatType === "group";

  const userId = payload.user?.id ?? payload.user?.open_id ?? "unknown";
  const messageId = payload.message_id;
  const timestamp = payload.timestamp;

  // Resolve agent route
  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: "default",
    peer: {
      kind: isGroup ? "group" : "direct",
      id: isGroup ? chatId : userId,
    },
  });

  // Build from label — in groups, include sender so agent knows who is speaking
  const from = isGroup
    ? `${senderLabel(payload.user, chatType)} in group:${chatId}`
    : `user:${userId}`;

  // Build system context for Claude.
  // For task actions, Claude should respond with ACTION:<json> on the FIRST line.
  // The plugin will intercept that, call the API itself via fetch(), and send a
  // human-readable reply — Claude does NOT need to call exec/curl.
  let bodyText = text;
  if (payload.userContext) {
    const uc = payload.userContext;
    const allowed = Object.entries(uc.allowedFeatures ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k);

    const systemContext = [
      `## Current User`,
      `Name: ${uc.name ?? "unknown"} | Role: ${uc.role ?? "user"} | open_id: ${uc.openId ?? "unknown"}`,
      `Allowed features: ${allowed.length ? allowed.join(", ") : "none"}`,
      ``,
      `## Task Actions`,
      `If the user's message involves a task operation, respond with ONLY this on the first line:`,
      `ACTION:{"action":"<name>", ...params}`,
      ``,
      `Available actions (only if user has the required feature):`,
      `- List tasks (cuiban_view):      ACTION:{"action":"list_tasks"}`,
      `- Complete task (cuiban_complete): ACTION:{"action":"complete_task","task_name":"<name or partial>","proof":"<url, optional>"}`,
      `- Create task (cuiban_create):   ACTION:{"action":"create_task","title":"<name>","target_open_id":"<open_id>","deadline":"YYYY-MM-DD (optional)"}`,
      ``,
      `After the ACTION line you may add a short friendly Chinese explanation for the user (optional).`,
      `If no task action is needed, reply normally in Chinese.`,
      `Only use actions the user is allowed to perform.`,
    ].join("\n");

    bodyText = `${text}\n\n${systemContext}`;
  }

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Lark (Feishu)",
    from,
    timestamp,
    body: bodyText,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: text,
    RawBody: text,
    CommandBody: text,
    From: isGroup ? `lark:group:${chatId}` : `lark:user:${userId}`,
    To: `lark:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    MessageSid: messageId,
    Timestamp: timestamp,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `lark:${chatId}`,
    SenderId: userId,
    ConversationLabel: isGroup ? `lark-group:${chatId}` : `lark-dm:${userId}`,
    GroupSubject: isGroup ? `lark-group:${chatId}` : undefined,
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: "default",
  });

  // Resolve reply endpoint
  const replyApiUrl = resolveReplyApiUrl(payload, larkCfg);
  const rabbitApiUrl = (larkCfg.rabbitApiUrl as string | undefined) ?? "http://localhost:3456";

  /** Send a text message back to the Feishu chat */
  async function sendToFeishu(content: string): Promise<void> {
    if (!replyApiUrl) return;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const resp = await fetch(replyApiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chat_id: chatId,
        content,
        ...(messageId ? { reply_to_message_id: messageId } : {}),
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[rabbit-lark] reply failed: ${resp.status} ${errText}`);
    }
  }

  /** Call rabbit-lark-bot API from the plugin (no exec/curl needed) */
  async function callRabbitApi(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const resp = await fetch(`${rabbitApiUrl}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!resp.ok) throw new Error(`API ${method} ${path} → ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }

  /** Execute an ACTION from Claude's structured response */
  async function executeAction(action: Record<string, unknown>, userOpenId: string | undefined): Promise<void> {
    const type = action.action as string;

    if (type === "list_tasks") {
      if (!userOpenId) { await sendToFeishu("⚠️ 无法识别你的用户 ID"); return; }
      const result = await callRabbitApi(`/api/agent/tasks?open_id=${encodeURIComponent(userOpenId)}`) as { tasks: Array<{id: number; title: string; deadline: string | null; status: string}> };
      const tasks = result.tasks ?? [];
      if (tasks.length === 0) {
        await sendToFeishu("✅ 你目前没有待办任务");
      } else {
        const lines = tasks.map((t, i) =>
          `${i + 1}. 【${t.title}】${t.deadline ? ` 截止 ${t.deadline.slice(0, 10)}` : ""}`
        );
        await sendToFeishu(`📋 你的待办任务（${tasks.length} 项）：\n\n${lines.join("\n")}\n\n发送「完成 任务名」标记完成`);
      }
      return;
    }

    if (type === "complete_task") {
      if (!userOpenId) { await sendToFeishu("⚠️ 无法识别你的用户 ID"); return; }
      // First list tasks to find the matching one
      const result = await callRabbitApi(`/api/agent/tasks?open_id=${encodeURIComponent(userOpenId)}`) as { tasks: Array<{id: number; title: string}> };
      const tasks = result.tasks ?? [];
      const taskName = (action.task_name as string | undefined)?.toLowerCase().trim() ?? "";
      const proof = (action.proof as string | undefined) ?? "";

      let target = tasks.find(t => t.title.toLowerCase() === taskName);
      if (!target) target = tasks.find(t => t.title.toLowerCase().includes(taskName));
      if (!target && tasks.length === 1) target = tasks[0]; // only one task, complete it

      if (!target) {
        if (tasks.length === 0) {
          await sendToFeishu("✅ 你目前没有待办任务");
        } else {
          const list = tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
          await sendToFeishu(`⚠️ 没找到「${taskName}」，你的待办任务是：\n\n${list}\n\n请发「完成 任务名」指定要完成哪个`);
        }
        return;
      }

      await callRabbitApi(`/api/agent/tasks/${target.id}/complete`, "POST", {
        user_open_id: userOpenId,
        proof,
      });
      await sendToFeishu(`✅ 任务「${target.title}」已标记为完成！${proof ? `\n📎 ${proof}` : ""}`);
      return;
    }

    if (type === "create_task") {
      const title = action.title as string;
      const targetOpenId = action.target_open_id as string;
      if (!title || !targetOpenId) { await sendToFeishu("⚠️ 创建任务需要任务名和被催办人"); return; }
      const taskResult = await callRabbitApi("/api/agent/tasks", "POST", {
        title,
        target_open_id: targetOpenId,
        reporter_open_id: userOpenId ?? null,
        deadline: action.deadline ?? null,
        note: action.note ?? null,
      }) as { task: { id: number; title: string } };
      await sendToFeishu(`📋 任务「${taskResult.task.title}」已创建，已通知执行人`);
      return;
    }

    console.warn(`[rabbit-lark] unknown action type: ${type}`);
  }

  const deliverReply = createNormalizedOutboundDeliverer(async (outPayload) => {
    if (!replyApiUrl) {
      console.warn("[rabbit-lark] no reply API URL available, cannot send reply");
      return;
    }
    const replyText = outPayload.text?.trim();
    if (!replyText) return;

    // Check if Claude returned a structured ACTION on the first line
    const firstLine = replyText.split("\n")[0].trim();
    if (firstLine.startsWith("ACTION:")) {
      try {
        const jsonStr = firstLine.slice("ACTION:".length).trim();
        const action = JSON.parse(jsonStr) as Record<string, unknown>;
        const userOpenId = payload.userContext?.openId;
        await executeAction(action, userOpenId);
        return; // action handled, don't send raw text
      } catch (err) {
        console.error("[rabbit-lark] failed to parse ACTION json:", err);
        // Fall through to send as regular text
      }
    }

    // Regular text reply
    await sendToFeishu(replyText);
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: deliverReply,
      onError: (err: unknown, info: { kind: string }) => {
        console.error(`[rabbit-lark] ${info.kind} reply error:`, err);
      },
    },
    replyOptions: { onModelSelected },
  });
}

// ---------------------------------------------------------------------------
// HTTP webhook handler
// ---------------------------------------------------------------------------

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  // Read body
  let rawBody: string;
  try {
    rawBody = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { reject(new Error("payload too large")); return; }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  } catch {
    res.writeHead(413, { "Content-Type": "text/plain" });
    res.end("Payload Too Large");
    return;
  }

  // Verify HMAC signature if rabbitApiKey configured
  const cfg = _currentCfg;
  if (cfg) {
    const larkCfg = getLarkCfg(cfg);
    const expectedKey = larkCfg.rabbitApiKey as string | undefined;
    if (expectedKey) {
      const signature =
        (req.headers["x-rabbit-lark-signature"] as string | undefined) ??
        (req.headers["x-api-key"] as string | undefined) ??
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "");
      if (!signature || !verifySignature(rawBody, signature, expectedKey)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
    }
  }

  let payload: RabbitLarkPayload;
  try {
    payload = JSON.parse(rawBody) as RabbitLarkPayload;
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request: invalid JSON");
    return;
  }

  // Ack immediately
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));

  // Process async
  processInbound(payload, rawBody).catch((err: unknown) => {
    console.error("[rabbit-lark] inbound processing error:", err);
  });
}

// ---------------------------------------------------------------------------
// Channel plugin definition
// ---------------------------------------------------------------------------

type LarkAccount = { accountId: string };

const larkChannel: ChannelPlugin<LarkAccount> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "Lark (Feishu)",
    selectionLabel: "Lark via Rabbit Bot",
    docsPath: "/channels/lark",
    blurb: "Receive Feishu/Lark messages bridged through rabbit-lark-bot.",
    aliases: ["feishu-bridge", "rabbit-lark"],
  },
  capabilities: { chatTypes: ["direct", "group"] },
  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (_cfg: unknown, accountId?: string) => ({
      accountId: accountId ?? "default",
    }),
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async () => ({ ok: true }),
  },
  gateway: {
    startAccount: async (ctx) => {
      _currentCfg = ctx.cfg;
      const larkCfg = getLarkCfg(ctx.cfg);
      const webhookPath = (larkCfg.webhookPath as string | undefined) ?? DEFAULT_WEBHOOK_PATH;
      ctx.log?.info(`[rabbit-lark] channel started, webhook at ${webhookPath}`);
    },
    stopAccount: async (ctx) => {
      ctx.log?.info("[rabbit-lark] channel stopped");
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export default function register(api: OpenClawPluginApi): void {
  _runtime = api.runtime;
  _currentCfg = api.config;

  const larkCfg = getLarkCfg(api.config);
  const webhookPath = (larkCfg.webhookPath as string | undefined) ?? DEFAULT_WEBHOOK_PATH;

  api.registerChannel({ plugin: larkChannel });
  api.registerHttpRoute({ path: webhookPath, handler: handleWebhook });

  api.logger.info(`[rabbit-lark] registered, webhook at ${webhookPath}`);
}
