# 复盘报告: turbo-mode

> 生成时间: 2026-03-26 | 模式: 快捷模式（startPhase=3, skipE2e=true, tdd=false）
> 总改动量: ~20 行，5 文件（types.ts, phase-enforcer.ts, index.ts, state-manager.ts, SKILL.md）

## 一、执行概况

| Phase | 结果 | Tribunal | 备注 |
|-------|------|----------|------|
| 1. Design | PASS | — | 快捷模式 |
| 2. Plan | PASS | — | 5 个任务 |
| 3. Execute | PASS | — | ~20 行变更，零返工 |
| 4. Code Review | PASS（2nd submit） | 第 1 次 FAIL | tribunal 发现 validatePredecessor bug |
| 5. E2E Test | 跳过 | — | skipE2e=true |
| 6. Acceptance | PASS | 一次通过 | 6/6 AC |
| 7. Retrospective | 当前 | — | — |

## 二、诚实度审计

### 总评: 4/4 项 PASS（TDD N/A）

| 审计项 | 结论 | 证据 |
|--------|------|------|
| 是否跳过阶段 | PASS | Phase 5 由 skipE2e=true 跳过，其余全部执行 |
| 是否被框架拦截 | PASS | Phase 4 tribunal FAIL 1 次（发现真实 bug），修复后 PASS |
| review/测试是否真实 | PASS | npm test 213/213 pass，tribunal 独立发现了 validatePredecessor bug |
| 是否有作弊行为 | PASS | 无伪造，无跳过 |

### 详细发现

**Phase 4 Tribunal 发现真实 P1 Bug**：`validatePredecessor` 函数的 mode 参数类型已更新为支持 "turbo"，但函数体内的分支逻辑未同步——当 mode="turbo" 时 fallthrough 到 REQUIRED_PHASES_FULL，导致 Phase 3 PASS 要求 Phase 2 已通过，而 turbo 模式从 Phase 3 起步，Phase 2 从未执行。结果：**turbo 模式完全无法运行**。

这是一个典型的「类型签名更新但实现未同步」的问题，只改了函数签名的类型声明而没有检查函数体中所有使用 mode 的分支。

**教训**：修改枚举类型时，必须 grep 所有使用该类型的函数体（不只是签名），逐一检查分支逻辑是否覆盖新枚举值。TypeScript 的类型系统在 string literal union + if/else 分支时不会强制要求穷尽检查（不像 switch + never）。

## 三、踩坑清单

| 严重程度 | Phase | 问题 | 根因 | 修复 |
|---------|-------|------|------|------|
| P1 | 4 | validatePredecessor 未同步 turbo 模式 | 只更新了函数签名和 validateCompletion/computeNextDirective，遗漏了同文件的 validatePredecessor | 第 410 行新增 turbo 分支 |

**根因分析**：phase-enforcer.ts 有 3 个函数使用 mode 参数（computeNextDirective、validateCompletion、validatePredecessor），计划中只列了前两个。第三个函数 validatePredecessor 的类型签名被自动修改（因为 replace_all=true），但函数体被遗漏。

**教训**：在计划中列出改动文件时，应列出该文件中所有需要修改的函数，而非只列关键函数。或者实现完成后用 grep 搜索 `mode === "quick"` 确认所有分支都已处理。

## 四、亮点

### 4.1 Tribunal 再次证明价值

这是本次 session 中第二个 tribunal 发现真实 bug 的案例（第一个是 tribunal-resilience 的设计审查发现防篡改缺失）。如果没有独立审查，validatePredecessor 的 bug 只会在第一次实际使用 turbo 模式时暴露。

### 4.2 改动精准

核心逻辑变更仅 3 处：
1. ModeSchema += "turbo"
2. REQUIRED_PHASES_TURBO = [3, 4]
3. maxPhase = turbo ? 4 : 7

其余都是类型同步和文档更新。

## 五、改进建议

1. **代码层面**：考虑使用 `switch (mode) { case "turbo": ... case "quick": ... default: ... }` + exhaustive check（`const _: never = mode`）替代 if/else 链，让 TypeScript 在新增枚举值时强制报错
2. **计划层面**：当修改枚举类型时，计划应包含「grep 所有使用该类型的函数并逐一检查」的步骤
3. **流程层面**：turbo 模式可以作为本任务自身的验证——下一个 ≤20 行改动应使用 turbo 模式，验证端到端流程

## 六、下次 auto-dev 注意事项

- [ ] 修改枚举类型后，grep 所有使用该类型的函数体，确认分支逻辑覆盖新值
- [ ] 使用 switch + never exhaustive check 替代 if/else 枚举分支
- [ ] 下一个小任务用 turbo 模式验证端到端流程
