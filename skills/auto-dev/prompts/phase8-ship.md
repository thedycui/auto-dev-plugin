# 交付验证 (Ship)

你正在执行交付验证阶段。请根据当前子步骤完成对应操作。

## 配置信息

- **部署组件**: {{deployTarget}}
- **部署分支**: {{deployBranch}}
- **目标环境**: {{deployEnv}}
- **验证方式**: {{verifyMethod}}

## 子步骤指引

### Step 8a: Push 代码

1. 确认当前分支和远程 tracking 关系
2. 执行 `git push` 推送所有本地 commit 到远程仓库
3. 如遇冲突，先 `git pull --rebase` 解决冲突后再 push
4. 验证：`git log --oneline --branches --not --remotes` 输出为空表示成功

### Step 8b: 构建

1. 调用 DevOps 构建工具构建组件 `{{deployTarget}}`
2. 等待构建完成（轮询构建状态）
3. 将构建结果写入 `{{output_dir}}/ship-build-result.md`
4. **文件必须包含关键词 `SUCCEED` 表示构建成功**，或包含失败原因

### Step 8c: 部署

1. 调用 DevOps 部署工具部署 `{{deployTarget}}` 到 `{{deployEnv}}` 环境
2. 等待部署完成（轮询部署状态）
3. 将部署结果写入 `{{output_dir}}/ship-deploy-result.md`
4. **文件必须包含关键词 `SUCCEED` 表示部署成功**，或包含失败原因

### Step 8d: 远程验证

根据验证方式 `{{verifyMethod}}` 执行对应的验证操作：

**API 验证** (`api`):
- 调用 `{{verifyEndpoint}}` 接口
- 检查响应是否匹配 `{{verifyExpectedPattern}}`

**日志验证** (`log`):
- SSH 连接到 `{{verifySshHost}}`
- 查看日志 `{{verifyLogPath}}`
- 搜索关键词 `{{verifyLogKeyword}}`

**组合验证** (`combined`):
- 同时执行 API 验证和日志验证

将验证结果写入 `{{output_dir}}/ship-verify-result.md`，必须包含以下关键词之一：
- **`PASS`** — 验证通过，功能正常工作
- **`CODE_BUG`** — 验证失败，原因是代码缺陷（需要回退修复）
- **`ENV_ISSUE`** — 验证失败，原因是环境问题（非代码问题，需人工排查）

## CODE_BUG vs ENV_ISSUE 判定标准

| 现象 | 判定 | 说明 |
|------|------|------|
| 接口返回 500 且日志有 NPE/ClassCastException | CODE_BUG | 代码逻辑错误 |
| 接口返回预期数据但字段值错误 | CODE_BUG | 业务逻辑缺陷 |
| 接口超时且日志无请求记录 | ENV_ISSUE | 网络/路由问题 |
| 部署成功但服务未启动 | ENV_ISSUE | 环境配置问题 |
| 日志有 "connection refused" 到下游服务 | ENV_ISSUE | 依赖服务问题 |
| 日志有新代码的异常堆栈 | CODE_BUG | 新引入的错误 |

**判定原则**：如果错误堆栈包含本次修改的代码文件/方法，判定为 CODE_BUG；否则优先判定为 ENV_ISSUE。

---
完成后不需要做其他操作。直接完成任务即可。
