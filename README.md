# Rabbit Lark Bot 🐰

飞书集成脚本和 Clawdbot Skill

## 功能

- 创建云文档
- 读取文档内容
- 搜索文档
- 发送消息（TODO）

## 使用

### 环境变量
```bash
export FEISHU_APP_ID=cli_xxxxx
export FEISHU_APP_SECRET=xxxxx
```

### 脚本

```bash
# 创建文档
./scripts/create_doc.sh "文档标题" "文档内容"

# 读取文档
./scripts/read_doc.sh <document_id>
```

## Clawdbot Skill

参见 `skill/` 目录

## 开发记录

- 2026-02-25: 初始化项目，测试 API 连接成功
