# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rabbit Lark Bot is a Feishu (Lark) AI agent bridge platform. It receives Feishu webhook events, routes messages by intent (greetings, task management "催办", or AI forwarding), and provides a Next.js admin dashboard. Written primarily in Chinese context.

## Monorepo Structure

```
packages/
  server/   → Express API + webhook handler (port 3456, plain JS)
  web/      → Next.js 14 admin dashboard (port 3000, TypeScript)
  mcp/      → Model Context Protocol server (ES modules)
  scripts/  → Utility scripts
db/
  init.sql       → Full schema
  migrations/    → Incremental SQL (001-008)
```

## Commands

### Server (packages/server)
```bash
npm run dev              # Hot-reload dev server (node --watch)
npm test                 # Run all tests (Jest)
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
```

### Web (packages/web)
```bash
npm run dev    # Next.js dev server (localhost:3000)
npm run build  # Production build
npm test       # Jest tests
npm run lint   # next lint
```

### Docker (all services)
```bash
docker compose up -d postgres              # DB only (for local dev)
docker compose up                          # All services (requires POSTGRES_PASSWORD in .env)
```

### Running a single test
```bash
cd packages/server && npx jest tests/agent.test.js
cd packages/web && npx jest __tests__/someFile.test.tsx
```

### Database migrations
```bash
docker exec rabbit-lark-db psql -U rabbit -d rabbit_lark < db/migrations/008_add_conversation_history.sql
```

## Architecture

### Request Flow
```
Feishu → POST /webhook/event → decrypt AES-256-CBC → dedup → auto-register user
  → intentDetector classifies message:
    greeting/menu → static reply
    cuiban_*      → cuibanHandler → task reminder service (CRUD + scheduled reminders)
    unknown       → agentForwarder → Anthropic API (direct tool calling)
                      ├── tools: list_tasks / create_task / complete_task
                      ├── conversation history in PostgreSQL (20 msgs/chat)
                      └── feishu.sendMessage() directly (no relay)
```

### Key Server Modules
- `src/routes/` — Express routes: `webhook.js`, `api.js`, `agent.js`, `users.js`
- `src/services/reminder.js` — Task CRUD, reminder scheduling, `sendPendingReminders()` runs every 15 min via `setInterval`
- `src/services/cuibanHandler.js` — Chat-based task commands (view/complete/create) + multi-step session selection
- `src/services/agentForwarder.js` — Direct Anthropic API integration: lazy singleton client, builds system prompt (user context + registered users + date), runs agentic loop (max 5 rounds, max 10 concurrent via semaphore), executes `list_tasks`/`create_task`/`complete_task` tools, persists conversation history in `conversation_history` table (atomic CTE pruning), replies via `feishu.sendMessage()`; requires `ANTHROPIC_API_KEY`
- `src/feishu/client.js` — Feishu REST API wrapper (messaging, user info, bitable); token cache with promise coalescing + retry-on-401
- `src/middleware/auth.js` — `feishuWebhookAuth` (raw-body signature + encrypted payload) and `apiAuth` (API key via SHA-256 hash + timingSafeEqual)
- `src/middleware/rateLimit.js` — In-memory fixed-window rate limiter (10k entry cap, batch ~10% eviction, single-instance only)
- `src/utils/intentDetector.js` — Regex-based message classification
- `src/utils/safeError.js` — Production-safe error messages (hides internals when NODE_ENV=production)
- `src/features/index.js` — Role-based permission registry (superadmin/admin/user)
- `src/db/` — Raw SQL queries via `pg` pool (no ORM)

### Web Key Patterns
- `src/lib/api.ts` — API client with `SWR_KEYS` constants (use these in all `useSWR`/`mutate` calls for cache consistency)
- `src/lib/auth.tsx` — Client-side password auth with login rate limiting (5 attempts, 1-min lockout); TODO: migrate to server-side sessions
- `src/components/UserCombobox.tsx` — Searchable user dropdown with keyboard navigation (arrows/enter/escape), filters to users with openId only, ARIA combobox roles
- `src/components/StatusStates.tsx` — Shared `LoadingState`/`ErrorState` components with ARIA roles; `ErrorState` accepts `onRetry` callback or `retryKey` for SWR

### Database
PostgreSQL 16. Key tables: `users` (with roles + feature overrides), `tasks` (assignee, deadline, reminder scheduling), `user_sessions` (multi-step dialog state, 5-min TTL). Uses raw SQL with `pg` library, no ORM.

### User ID Types
- `user_id` — canonical (email or Feishu user_id)
- `open_id` — Feishu `ou_xxx` for messaging API
- `feishu_user_id` — Feishu `on_xxx` from webhook events

### Permission System
Three roles: `superadmin > admin > user`. Features resolved per-user: user override → role default. Feature keys: `cuiban_view`, `cuiban_create`, `cuiban_complete`, `history`, `user_manage`, `feature_manage`, `system_config`.

## Conventions

- **Commits**: Conventional Commits format — `feat(scope): description`, `fix(web): ...`, `docs: ...`
- **Server**: Plain JavaScript (no TypeScript), Node.js 18+
- **Web**: TypeScript, Tailwind CSS, SWR for data fetching with `SWR_KEYS` constants from `@/lib/api`
- **Database**: Raw SQL, incremental migration files in `db/migrations/`
- **Environment**: Single `.env` file at repo root, loaded via `dotenv` with path `../../../.env` from server
- **Tests**: Jest + supertest (server), Jest + React Testing Library (web)
- **Auth**: `API_KEY` env var required in production; in `NODE_ENV=development` auth is skipped; all other environments require API_KEY
- **Error handling**: Use `safeErrorMessage(err)` in route handlers; raw `err.message` only in debug logs; never include user IDs in error messages
- **Settings whitelist**: `PUT /settings/:key` only accepts keys in the `VALID_SETTING_KEYS` array — add new keys there when adding settings
- **Body size**: Express body parser limited to 1mb; raw body preserved via `verify` callback for webhook signature verification
- **Single-instance**: Event dedup (webhook.js) and rate limiting (rateLimit.js, 10k entry cap) use in-memory Maps — document this limitation for multi-instance deployments
