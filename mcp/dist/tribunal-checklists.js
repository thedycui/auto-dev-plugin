/**
 * Tribunal checklists for each phase.
 * Used by the tribunal agent to evaluate phase deliverables.
 */
const ANTI_LENIENCY = '默认立场是 FAIL。PASS 必须逐条举证。';
const PHASE_4_CHECKLIST = `## 裁决检查清单（Phase 4: Code Review + Phase 1/2 回溯验证）

> ${ANTI_LENIENCY}

> **审查范围约束**: 只审查本次 diff 涉及的文件和变更。不得对 diff 之外的代码、架构或历史遗留问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。

### A. 回溯验证（最高优先级）
- [ ] 逐条检查 designReview 中的每个 P0/P1 问题
- [ ] 在 design.md 或 diff 中找到对应修复证据
- [ ] 如果 designReview 中有 P0 未修复 → 直接 FAIL
- [ ] 逐条检查 planReview 中的问题，在 diff 中验证

### B. 代码审查
- [ ] 独立审查 diff，不要只依赖主 Agent 的 review 报告
- [ ] 检查设计文档中的每个需求是否在 diff 中有对应实现
- [ ] 检查安全问题（权限绕过、注入、数据泄露）
- [ ] 检查 API 一致性（前后端接口匹配）

### C. TDD Gate Verification (if tdd=true)
- [ ] Check state.json tddTaskStates: every non-exempt task should have status=GREEN_CONFIRMED
- [ ] If any task has status=RED_CONFIRMED or PENDING, TDD flow was not completed -> FAIL
- [ ] Cross-check: test files in diff should align with redTestFiles recorded in tddTaskStates

### D. 输出要求
- 回溯验证结果：TRACE: [Phase 1/2 问题描述] → FIXED / NOT_FIXED → [证据]
- 如果 FAIL，列出问题：ISSUE: [P0/P1] 问题描述 → 修复建议 → 涉及文件
`;
const PHASE_5_CHECKLIST = `## 裁决检查清单（Phase 5: 测试裁决）

> ${ANTI_LENIENCY}

> **审查范围约束**: 只审查本次 diff 涉及的测试文件和测试结果。不得对 diff 之外的测试覆盖率、历史测试问题提出 P0/P1。P0/P1 必须关联具体的验收标准（acRef）。

### 1. 测试真实性
- [ ] 对比框架的 testLog 和 Agent 的 agentResults，是否一致？
- [ ] agentResults 中标 PASS 的测试，在 testLog 中是否真的通过？
- [ ] 是否有 testLog 中不存在但 agentResults 中标 PASS 的测试？

### 2. SKIP 审查（举证倒置）
- [ ] 每个 SKIP/DEFERRED 是否有执行失败的错误日志？
- [ ] "需要部署环境"不是有效理由——检查是否有已部署的环境可以用 curl 测试
- [ ] 接口级测试（curl/HTTP）不允许标 SKIP

### 3. 覆盖率
- [ ] 设计文档中的每个功能点是否有对应测试？
- [ ] 是否有功能点完全没有测试覆盖？

### 4. 测试质量
- [ ] 测试是否在验证真实功能？（assertTrue(true) 是假测试）
- [ ] 断言是否有意义？
`;
const PHASE_6_CHECKLIST = `## 裁决检查清单（Phase 6: 验收裁决）

> ${ANTI_LENIENCY}

> **审查范围约束**: 只验证本次任务的验收标准（AC），不得引入任务范围外的要求。P0/P1 必须关联具体的验收标准（acRef）。

### A. 框架自动验证（硬数据，最高权重）
- [ ] 读取 framework-ac-results.json（如存在）
- [ ] Layer 1 (structural) 有 FAIL 项？→ 直接 FAIL（除非 Agent 给出充分的 AC 定义缺陷证据）
- [ ] Layer 2 (test-bound) 有 FAIL 项？→ 直接 FAIL（测试不通过 = AC 未满足）
- [ ] 框架 PASS 项与 Agent 报告一致？不一致则以框架结果为准

### B. AC 绑定完整性
- [ ] 所有 test-bound AC 是否都有绑定测试？
- [ ] 是否有 AC 被降级为 manual？如果有，降级理由是否充分？
- [ ] structural 断言是否覆盖了 AC 描述的关键点？

### C. Manual AC 验证
- [ ] 从 design.md 中提取 manual AC（或所有 AC 如无 framework-ac-results.json）
- [ ] Agent 的主观判断是否有充分的代码证据？
- [ ] 对每条标准，在 diff 中找到对应实现
- [ ] 找不到实现的标准 → FAIL
- [ ] SKIP 必须有合理理由（真的做不到，不是偷懒）

### D. 输出要求
- AC 验证表（含层级、验证方式、框架结果引用）
- 框架 FAIL 分析（如有）
- AC: {描述} → PASS/FAIL/SKIP → {证据或原因}
`;
const PHASE_7_CHECKLIST = `## 裁决检查清单（Phase 7: 复盘裁决）

> ${ANTI_LENIENCY}

### 1. 数据一致性
- [ ] 主 Agent 报告中的数字（拦截次数、测试通过率等）是否与框架数据一致？
- [ ] 如果不一致 → FAIL（数据造假）

### 2. 问题是否被遗漏
- [ ] 裁决记录中发现的 ISSUE，是否在复盘报告的"踩坑清单"中体现？
- [ ] 被框架拦截的次数，是否在"诚实度审计"中如实报告？
- [ ] 如果有裁决 FAIL 记录但复盘中未提及 → FAIL（选择性遗忘）

### 3. 根因分析深度
- [ ] 每个踩坑是否有根因分析（不只是"做错了"，而是"为什么做错"）？
- [ ] 是否有可复用的改进措施（不只是"下次注意"）？
- [ ] 如果只有表面描述没有根因 → FAIL（敷衍）

### 4. 教训可操作性
- [ ] 教训是否具体到可以指导下一次开发？
- [ ] "以后会注意" 不是有效教训
- [ ] 有效教训示例："跨端开发时，先用 curl 确认后端实际接口签名，再写前端调用代码"
`;
const CHECKLISTS = {
    4: PHASE_4_CHECKLIST,
    5: PHASE_5_CHECKLIST,
    6: PHASE_6_CHECKLIST,
};
/**
 * Returns the tribunal checklist markdown for the given phase.
 * @param phase - Phase number (4, 5, or 6)
 * @returns Markdown checklist string
 * @throws Error if phase does not have a tribunal checklist
 */
export function getTribunalChecklist(phase) {
    const checklist = CHECKLISTS[phase];
    if (!checklist) {
        throw new Error(`No tribunal checklist for phase ${phase}. Tribunal phases are: 4, 5, 6.`);
    }
    return checklist;
}
//# sourceMappingURL=tribunal-checklists.js.map