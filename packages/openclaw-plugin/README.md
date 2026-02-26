# rabbit-lark OpenClaw Plugin

An OpenClaw channel plugin that receives Feishu/Lark messages forwarded by
rabbit-lark-bot and routes them to the Claude AI agent.

## Installation

```bash
cp -r packages/openclaw-plugin ~/.openclaw/extensions/rabbit-lark
openclaw gateway restart
```

## Config (`openclaw.json`)

```json
{
  "channels": {
    "lark": {
      "enabled": true,
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "rabbitApiUrl": "http://localhost:3456"
    }
  },
  "plugins": {
    "allow": ["rabbit-lark"],
    "load": { "paths": ["~/.openclaw/extensions/rabbit-lark"] }
  }
}
```

## Flow

```
Feishu → rabbit-lark-bot → POST /lark-webhook → OpenClaw plugin
                                                      ↓
Feishu ← POST /api/agent/send ← rabbit-lark-bot ← Claude reply
```
