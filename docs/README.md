# Documentation

## Contents

| Document | Description |
|----------|-------------|
| [architecture.md](architecture.md) | System architecture, data flow, deployment |
| [api.md](api.md) | Complete REST API reference |
| [setup-openclaw.md](setup-openclaw.md) | ~~OpenClaw AI Agent integration~~ (deprecated — now using direct Anthropic API) |
| [troubleshooting.md](troubleshooting.md) | Common issues and solutions |
| [edit-history/](edit-history/) | Daily development logs |

## Quick Links

### For Users
- [Bot Commands](../README.md#催办任务系统) - Feishu bot commands
- [Task Completion Format](troubleshooting.md#催办任务发送xxx-任务完成没反应) - Correct message format

### For Developers
- [Architecture Overview](architecture.md#系统架构) - System structure
- [Database Schema](architecture.md#数据库-schema) - Table definitions
- [Security](architecture.md#安全) - Auth, OAuth, JWT sessions, API keys, and rate limiting
- [Auth Endpoints](api.md#认证端点) - Feishu OAuth + password login
- [API Key Management](api.md#api-key-管理) - Per-agent DB-backed API keys

### For Operators
- [~~OpenClaw Setup~~](setup-openclaw.md) - Deprecated (replaced by direct Anthropic API)
- [Troubleshooting](troubleshooting.md) - Common deployment pitfalls
- [Environment Variables](../.env.example) - Annotated env var reference

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development workflow and code standards.
