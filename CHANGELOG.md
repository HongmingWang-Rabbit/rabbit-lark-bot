# Changelog

所有重要更改都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added
- 初始化 monorepo 结构
- Server: Express API + 飞书 Webhook
- Web: Next.js 管理后台 Dashboard
- PostgreSQL 数据库支持（管理员、配置、审计日志）
- Docker Compose 部署方案
- Jest 单元测试（server + web）
- GitHub Actions CI/CD
- 结构化日志系统
- ESLint 代码规范检查

### Features
- 催办任务管理（创建、完成、删除）
- 管理员权限控制
- 飞书机器人消息交互
- 多维表格集成

### Security (2026-02-25)
- 添加飞书 Webhook 签名验证中间件
- 添加 API 身份验证中间件（API Key / Bearer Token）
- 添加 Rate Limiting（API: 100/min, Webhook: 200/min）
- 添加环境变量验证（启动时检查必需配置）
- 修复 admins.add 的 upsert 逻辑（支持 email-only 添加）

### Changed
- webhook.js 改用结构化 logger 替代 console.log
- 更新 .env.example 添加安全相关配置说明

### Fixed (2026-02-25 Code Review Round 1)
- **[Critical]** feishu/client.js: 添加错误处理、请求超时、响应验证
- **[Critical]** webhook.js: 修复 userSessions 内存泄漏，添加会话过期机制
- **[Critical]** web/api.ts: 添加 API Key 认证头传递
- **[Warning]** services/reminder.js: 提取魔法数字为常量 (DEFAULT_DEADLINE_DAYS)
- **[Warning]** services/reminder.js: 集中管理字段名常量 (FIELDS, STATUS)
- **[Warning]** webhook.js: 修复数字选择边界检查（0 和越界）
- **[Warning]** web/api.ts & tasks/page.tsx: 添加完整 TypeScript 类型定义
- **[Refactor]** webhook.js: 拆分消息处理函数，提高可读性和可维护性

---

## 版本记录模板

## [x.y.z] - YYYY-MM-DD

### Added
- 新功能

### Changed
- 变更

### Deprecated
- 即将移除的功能

### Removed
- 已移除的功能

### Fixed
- Bug 修复

### Security
- 安全相关更新
