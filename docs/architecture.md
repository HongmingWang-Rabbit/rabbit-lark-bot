# Architecture

## Overview

Rabbit Lark Bot is a monorepo containing a Feishu (Lark) automation toolkit with three main packages:

```
rabbit-lark-bot/
├── packages/
│   ├── server/     # Express API + Feishu Webhook
│   ├── web/        # Next.js Dashboard
│   └── scripts/    # CLI Tools (Bash)
├── db/             # Database schema
└── docs/           # Documentation
```

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Feishu Bot    │────▶│   Server API    │────▶│   PostgreSQL    │
│  (Webhook)      │     │   (Express)     │     │   (Database)    │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 │ REST API
                                 │
                        ┌────────▼────────┐
                        │   Web Dashboard │
                        │   (Next.js)     │
                        └─────────────────┘
```

## Package Details

### packages/server

Express.js API server handling:

- **Feishu Webhook** (`/webhook/event`) - Receives messages from Feishu bot
- **REST API** (`/api/*`) - CRUD operations for tasks, admins, settings
- **Middleware** - Authentication, rate limiting, logging

#### Directory Structure

```
server/
├── src/
│   ├── index.js          # Entry point
│   ├── routes/
│   │   ├── api.js        # REST API routes
│   │   └── webhook.js    # Feishu webhook handler
│   ├── services/
│   │   └── reminder.js   # Task/reminder business logic
│   ├── db/
│   │   └── index.js      # PostgreSQL operations
│   ├── feishu/
│   │   └── client.js     # Feishu API client
│   ├── middleware/
│   │   ├── auth.js       # Authentication
│   │   └── rateLimit.js  # Rate limiting
│   └── utils/
│       ├── logger.js     # Structured logging
│       └── validateEnv.js
└── tests/
    ├── api.test.js
    └── db.test.js
```

### packages/web

Next.js dashboard for administration:

- **Dashboard** - Stats overview, recent activity
- **Tasks** - Create, view, complete, delete tasks
- **Admins** - Manage admin whitelist
- **Settings** - System configuration

#### Directory Structure

```
web/
├── src/
│   ├── app/
│   │   ├── page.tsx         # Dashboard
│   │   ├── tasks/page.tsx   # Task management
│   │   ├── admins/page.tsx  # Admin management
│   │   ├── settings/page.tsx
│   │   └── layout.tsx
│   └── lib/
│       └── api.ts           # API client with types
└── tests/
    └── components.test.tsx
```

### packages/scripts

Bash CLI tools for direct interaction:

- `reminder.sh` - Task management CLI
- `feishu.sh` - Feishu API wrapper functions

## Data Flow

### Feishu Bot Message Flow

1. User sends message to Feishu bot
2. Feishu sends webhook to `/webhook/event`
3. Server validates signature (if configured)
4. Message parsed and handled by `handleUserMessage()`
5. Response sent back via Feishu API

### Web Dashboard Flow

1. User accesses dashboard
2. Next.js fetches data from `/api/*` endpoints
3. Server queries PostgreSQL / Feishu Bitable
4. Data returned and rendered

## Database Schema

```sql
-- Admin whitelist
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE,
    email VARCHAR(255) UNIQUE,
    name VARCHAR(100),
    role VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Configuration KV store
CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64),
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Security

### Authentication

- **API**: API Key via `X-API-Key` header or Bearer token
- **Webhook**: Feishu signature verification (optional)
- **Admin**: Database whitelist check

### Rate Limiting

- API: 100 requests/minute per IP
- Webhook: 200 requests/minute per IP

### Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `FEISHU_APP_ID` - Feishu app credentials
- `FEISHU_APP_SECRET`
- `REMINDER_APP_TOKEN` - Bitable app token
- `REMINDER_TABLE_ID` - Bitable table ID

Optional:
- `API_KEY` - API authentication key
- `FEISHU_ENCRYPT_KEY` - Webhook signature key
- `LOG_LEVEL` - Logging level (error/warn/info/debug)

## Deployment

### Docker Compose

```bash
docker-compose up -d
```

Services:
- `postgres` - Database (port 5432, localhost only)
- `server` - API server (port 3456)
- `web` - Dashboard (port 3000)

### Manual

```bash
# Start database
docker-compose up -d postgres

# Start server
cd packages/server && npm install && npm start

# Start web (separate terminal)
cd packages/web && npm install && npm run build && npm start
```

## Configuration

### Feishu Setup

1. Create app at [open.feishu.cn](https://open.feishu.cn)
2. Enable bot capability
3. Configure webhook URL: `http://YOUR_SERVER:3456/webhook/event`
4. Add event: `im.message.receive_v1`
5. Grant permissions: `bitable:app`, `im:message`

### Bitable Setup

1. Create bitable with required fields:
   - 任务名称 (Text)
   - 催办对象 (Person)
   - 截止时间 (DateTime)
   - 状态 (Single Select: 待办/进行中/已完成)
   - 证明材料 (URL)
   - 备注 (Text)
   - 创建时间 (DateTime)
