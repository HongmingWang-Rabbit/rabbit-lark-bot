# Contributing Guide

## 开发流程

每次更新任何代码或配置，必须遵循以下流程：

### 1. 代码审查 (Code Review)

- [ ] 所有更改必须通过 PR 提交（非紧急情况禁止直接 push main）
- [ ] PR 需要至少 1 人 review 通过
- [ ] CI 检查必须全部通过（lint、test、build）
- [ ] 代码风格符合 ESLint 规范

### 2. 文档更新 (Documentation)

每次代码更改后，检查并更新相关文档：

- [ ] **README.md** - 安装、配置、使用说明是否需要更新？
- [ ] **API 文档** - 新增/修改了 API 接口？更新 `docs/api.md`
- [ ] **代码注释** - 复杂逻辑是否有清晰注释？
- [ ] **CHANGELOG.md** - 记录本次更改

### 3. Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Type:**
- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档更新
- `style` - 代码格式（不影响逻辑）
- `refactor` - 重构
- `test` - 测试相关
- `chore` - 构建/工具相关

**示例:**
```
feat(server): add user authentication middleware
fix(web): correct task status display
docs: update API documentation for /tasks endpoint
```

### 4. PR 模板

创建 PR 时请包含：

```markdown
## 变更说明
简要描述本次更改内容

## 变更类型
- [ ] 新功能 (feat)
- [ ] Bug 修复 (fix)
- [ ] 文档更新 (docs)
- [ ] 重构 (refactor)
- [ ] 其他

## 测试
- [ ] 已添加/更新相关测试
- [ ] 本地测试通过

## 文档
- [ ] README.md 已更新（如需要）
- [ ] API 文档已更新（如需要）
- [ ] CHANGELOG.md 已更新

## 截图（如有 UI 变更）
```

---

## 文件结构说明

更新代码时，确保文件放在正确位置：

```
packages/
├── server/
│   ├── src/
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑
│   │   ├── db/          # 数据库操作
│   │   ├── feishu/      # 飞书 API
│   │   ├── middleware/  # 中间件
│   │   └── utils/       # 工具函数
│   └── tests/           # 测试文件
├── web/
│   ├── src/
│   │   ├── app/         # 页面
│   │   ├── components/  # 组件
│   │   └── lib/         # 工具库
│   └── tests/           # 测试文件
└── scripts/             # CLI 脚本
```

## Review Checklist

审查代码时检查：

- [ ] 代码逻辑正确
- [ ] 没有安全漏洞（SQL 注入、XSS 等）
- [ ] 错误处理完善
- [ ] 日志记录合理
- [ ] 性能可接受
- [ ] 测试覆盖关键路径
- [ ] 文档已同步更新
