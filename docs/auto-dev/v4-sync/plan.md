# 实施计划: v4 SKILL 对齐 (v5.1)

## 任务列表

### Task 1: types.ts 新增 interactive/dryRun 字段
- **文件**: mcp/src/types.ts
- **复杂度**: S

### Task 2: auto_dev_init 支持 interactive/dryRun 参数
- **文件**: mcp/src/index.ts
- **依赖**: Task 1
- **复杂度**: S

### Task 3: auto_dev_preflight 新增 Phase 6 检查
- **文件**: mcp/src/index.ts
- **依赖**: Task 1
- **复杂度**: S

### Task 4: 新增 acceptance-validator Agent
- **文件**: agents/auto-dev-acceptance-validator.md
- **复杂度**: S

### Task 5: 更新 SKILL.md (Phase 6 + 行为反转 + dry-run)
- **文件**: skills/auto-dev/SKILL.md
- **依赖**: Task 2, 3, 4
- **复杂度**: M

### Task 6: 更新 commands/auto-dev.md
- **文件**: commands/auto-dev.md
- **依赖**: Task 5
- **复杂度**: S
