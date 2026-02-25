# 🐰 Rabbit Lark MCP

MCP (Model Context Protocol) server that connects AI agents to Lark/Feishu messaging platform.

## Overview

This MCP server allows any AI agent (Claude, GPT, etc.) to:
- Send messages to Lark users and groups
- Reply to specific messages
- React with emojis
- Get message history
- Look up user information

## Installation

```bash
npm install @rabbit-lark/mcp
```

Or run directly:

```bash
npx @rabbit-lark/mcp
```

## Configuration

Set these environment variables:

```bash
# Required: URL of your Rabbit Lark Bot server
RABBIT_LARK_API_URL=https://your-server.com

# Required: API key for authentication
RABBIT_LARK_API_KEY=your-api-key
```

## Usage with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rabbit-lark": {
      "command": "npx",
      "args": ["@rabbit-lark/mcp"],
      "env": {
        "RABBIT_LARK_API_URL": "https://your-server.com",
        "RABBIT_LARK_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Usage with Clawdbot

Add to your Clawdbot config:

```yaml
mcp:
  rabbit-lark:
    command: npx @rabbit-lark/mcp
    env:
      RABBIT_LARK_API_URL: https://your-server.com
      RABBIT_LARK_API_KEY: your-api-key
```

## Available Tools

### rabbit_lark_send

Send a message to a Lark user or group.

```json
{
  "chat_id": "user_id or chat_id",
  "content": "Hello from AI!",
  "msg_type": "text"
}
```

### rabbit_lark_reply

Reply to a specific message.

```json
{
  "message_id": "om_xxx",
  "content": "This is a reply"
}
```

### rabbit_lark_react

Add an emoji reaction.

```json
{
  "message_id": "om_xxx",
  "emoji": "thumbsup"
}
```

### rabbit_lark_get_history

Get message history from a chat.

```json
{
  "chat_id": "oc_xxx",
  "limit": 20
}
```

### rabbit_lark_get_user

Get user information.

```json
{
  "user_id": "ou_xxx"
}
```

## Message Flow

```
┌─────────────┐     MCP Protocol     ┌──────────────────┐
│  AI Agent   │ ◄──────────────────► │  rabbit-lark-mcp │
│  (Claude)   │                      │     server       │
└─────────────┘                      └────────┬─────────┘
                                              │
                                         HTTP API
                                              │
                                              ▼
                                     ┌────────────────┐
                                     │ Rabbit Lark    │
                                     │ Bot Server     │
                                     └────────┬───────┘
                                              │
                                         Lark API
                                              │
                                              ▼
                                     ┌────────────────┐
                                     │  Lark/Feishu   │
                                     └────────────────┘
```

## Receiving Messages

To receive messages from Lark users, register your agent's webhook with the Rabbit Lark Bot server:

```bash
curl -X POST https://your-server.com/api/agent/register \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent",
    "webhook_url": "https://my-agent.com/webhook",
    "api_key": "optional-shared-secret"
  }'
```

Messages will be forwarded to your webhook in this format:

```json
{
  "source": {
    "bridge": "rabbit-lark-bot",
    "platform": "lark",
    "version": "1.0.0",
    "capabilities": ["text", "image", "file", "reply", "reaction"]
  },
  "reply_via": {
    "mcp": "rabbit-lark",
    "api": "https://your-server.com/api/agent/send"
  },
  "event": "message",
  "message_id": "om_xxx",
  "chat_id": "oc_xxx",
  "user": {
    "id": "ou_xxx",
    "type": "user"
  },
  "content": {
    "type": "text",
    "text": "Hello agent!"
  },
  "timestamp": 1234567890
}
```

## License

MIT
