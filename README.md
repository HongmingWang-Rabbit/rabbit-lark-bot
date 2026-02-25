# Rabbit Lark Bot 🐰

飞书集成脚本和 Clawdbot Skill

## 功能

### 📌 催办任务管理
- 添加催办任务到飞书多维表格
- 查看待办/所有任务
- 标记任务完成
- 删除任务

### 📄 云文档操作
- 创建文档
- 读取文档
- 搜索文档

## 快速开始

### 催办任务

```bash
# 添加催办任务
./scripts/reminder.sh add "提交周报" "小明" "2026-03-01" "本周五前"

# 查看所有任务
./scripts/reminder.sh list

# 查看待办任务
./scripts/reminder.sh pending

# 标记完成
./scripts/reminder.sh complete <record_id> "证明材料链接"

# 删除任务
./scripts/reminder.sh delete <record_id>
```

### 云文档

```bash
# 创建文档
./scripts/create_doc.sh "文档标题"

# 读取文档
./scripts/read_doc.sh <document_id>

# 搜索文档
./scripts/search_docs.sh "关键词"
```

## 配置

环境变量在 `config.sh`:
- `FEISHU_APP_ID` - 飞书应用 ID
- `FEISHU_APP_SECRET` - 飞书应用密钥
- `REMINDER_APP_TOKEN` - 催办表格 App Token
- `REMINDER_TABLE_ID` - 催办表格 Table ID

## 飞书资源

- 催办表格: https://haidilao.feishu.cn/base/A6EybLpfOa5hzIsXjWyc4L5GnLb

## 开发记录

- 2026-02-25: 初始化项目
- 2026-02-25: 添加催办任务管理功能
