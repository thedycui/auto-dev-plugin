/**
 * Tests for orchestrator-prompts.ts — feedback translation layer.
 */

import { describe, it, expect } from "vitest";
import {
  containsFrameworkTerms,
  buildRevisionPrompt,
  buildPreviousAttemptSummary,
  translateFailureToFeedback,
  parseApproachPlan,
  extractOneLineReason,
  buildCircuitBreakPrompt,
} from "../orchestrator-prompts.js";

// ---------------------------------------------------------------------------
// containsFrameworkTerms
// ---------------------------------------------------------------------------

describe("containsFrameworkTerms", () => {
  it("detects 'checkpoint'", () => {
    expect(containsFrameworkTerms("Please pass the checkpoint")).toBe(true);
  });

  it("detects 'tribunal'", () => {
    expect(containsFrameworkTerms("The tribunal rejected this")).toBe(true);
  });

  it("detects 'auto_dev_submit'", () => {
    expect(containsFrameworkTerms("call auto_dev_submit now")).toBe(true);
  });

  it("detects 'Phase 3'", () => {
    expect(containsFrameworkTerms("You are in Phase 3")).toBe(true);
  });

  it("detects '迭代限制'", () => {
    expect(containsFrameworkTerms("已达到迭代限制")).toBe(true);
  });

  it("allows normal task text", () => {
    expect(containsFrameworkTerms("请为 XX 功能写设计方案")).toBe(false);
  });

  it("allows plain Chinese feedback", () => {
    expect(containsFrameworkTerms("测试执行失败，请修复代码")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRevisionPrompt
// ---------------------------------------------------------------------------

describe("buildRevisionPrompt", () => {
  it("includes feedback, original task, and artifact list", () => {
    const result = buildRevisionPrompt({
      originalTask: "实现用户登录功能",
      feedback: "缺少输入校验",
      artifacts: ["src/login.ts", "src/validator.ts"],
    });
    expect(result).toContain("缺少输入校验");
    expect(result).toContain("实现用户登录功能");
    expect(result).toContain("- src/login.ts");
    expect(result).toContain("- src/validator.ts");
  });

  it("uses markdown section headers in new format", () => {
    const result = buildRevisionPrompt({
      originalTask: "实现用户登录功能",
      feedback: "缺少输入校验",
      artifacts: ["src/login.ts"],
    });
    expect(result).toContain("修订:");
    expect(result).toContain("反馈:");
    expect(result).toContain("文件:");
  });

  it("includes previousAttemptSummary section when provided", () => {
    const result = buildRevisionPrompt({
      originalTask: "实现功能",
      feedback: "有问题",
      artifacts: [],
      previousAttemptSummary: "上次缺少错误处理",
    });
    expect(result).toContain("上次缺少错误处理");
    expect(result).toContain("上次:");
  });

  it("omits 历史尝试 section when previousAttemptSummary is not provided", () => {
    const result = buildRevisionPrompt({
      originalTask: "实现功能",
      feedback: "有问题",
      artifacts: [],
    });
    expect(result).not.toContain("上次:");
  });

  it("output does not contain framework terms", () => {
    const result = buildRevisionPrompt({
      originalTask: "实现用户登录功能",
      feedback: "缺少输入校验",
      artifacts: ["src/login.ts"],
    });
    expect(containsFrameworkTerms(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPreviousAttemptSummary
// ---------------------------------------------------------------------------

describe("buildPreviousAttemptSummary", () => {
  it("includes step id and attempt count", () => {
    const result = buildPreviousAttemptSummary(
      "1b",
      { totalAttempts: 2, revisionCycles: 1, tribunalAttempts: 0 },
      "缺少测试覆盖",
    );
    expect(result).toContain("1b");
    expect(result).toContain("2");
  });

  it("includes truncated first line of current feedback", () => {
    const result = buildPreviousAttemptSummary(
      "2b",
      { totalAttempts: 1, revisionCycles: 0, tribunalAttempts: 0 },
      "编译失败：找不到模块\n详细信息：xxx",
    );
    expect(result).toContain("编译失败");
  });
});

// ---------------------------------------------------------------------------
// translateFailureToFeedback
// ---------------------------------------------------------------------------

describe("translateFailureToFeedback", () => {
  it("PHASE1_REVIEW_MISSING returns actionable feedback without framework terms", () => {
    const result = translateFailureToFeedback("PHASE1_REVIEW_MISSING", "");
    expect(result).toContain("设计方案缺少审查文档");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("PHASE2_REVIEW_MISSING returns actionable feedback without framework terms", () => {
    const result = translateFailureToFeedback("PHASE2_REVIEW_MISSING", "");
    expect(result).toContain("实施计划缺少审查文档");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("PHASE5_ARTIFACTS_MISSING returns feedback without framework terms", () => {
    const result = translateFailureToFeedback("PHASE5_ARTIFACTS_MISSING", "");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("PHASE6_ARTIFACTS_MISSING returns feedback without framework terms", () => {
    const result = translateFailureToFeedback("PHASE6_ARTIFACTS_MISSING", "");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("PHASE7_RETROSPECTIVE_MISSING returns feedback without framework terms", () => {
    const result = translateFailureToFeedback("PHASE7_RETROSPECTIVE_MISSING", "");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("TRIBUNAL_FAIL parses JSON array and returns readable feedback", () => {
    const issues = [
      { severity: "P0", description: "未审查调用方", file: "src/a.ts" },
    ];
    const result = translateFailureToFeedback("TRIBUNAL_FAIL", JSON.stringify(issues));
    expect(result).toContain("P0");
    expect(result).toContain("未审查调用方");
    expect(result).toContain("src/a.ts");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("TRIBUNAL_FAIL with multiple issues formats all of them", () => {
    const issues = [
      { severity: "P0", description: "问题一", file: "src/a.ts", suggestion: "修复建议" },
      { severity: "P1", description: "问题二" },
    ];
    const result = translateFailureToFeedback("TRIBUNAL_FAIL", JSON.stringify(issues));
    expect(result).toContain("问题一");
    expect(result).toContain("问题二");
    expect(result).toContain("修复建议");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("TRIBUNAL_FAIL with invalid JSON falls back gracefully", () => {
    const result = translateFailureToFeedback("TRIBUNAL_FAIL", "not json");
    expect(result).toContain("not json");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("TEST_FAILED returns feedback with the error detail", () => {
    const result = translateFailureToFeedback(
      "TEST_FAILED",
      "AssertionError: expected 1 to be 2",
    );
    expect(result).toContain("AssertionError: expected 1 to be 2");
    expect(result).toContain("测试执行失败");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("TRIBUNAL_OVERRIDDEN returns feedback", () => {
    const result = translateFailureToFeedback("TRIBUNAL_OVERRIDDEN", "测试实际未通过");
    expect(result).toContain("测试实际未通过");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("BUILD_FAILED returns feedback with error detail", () => {
    const result = translateFailureToFeedback("BUILD_FAILED", "compilation error");
    expect(result).toContain("compilation error");
    expect(result).toContain("编译失败");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("unknown error code returns generic feedback without framework terms", () => {
    const result = translateFailureToFeedback("UNKNOWN_CODE", "something went wrong");
    expect(result).toContain("something went wrong");
    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("unknown error code with empty detail uses errorCode", () => {
    const result = translateFailureToFeedback("UNKNOWN_CODE", "");
    expect(result).toContain("UNKNOWN_CODE");
    expect(containsFrameworkTerms(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseApproachPlan (Task 7)
// ---------------------------------------------------------------------------

describe("parseApproachPlan", () => {
  it("parses standard format with primary + 2 alternatives", () => {
    const content = [
      "## 主方案",
      "- **方法**: 使用 vitest mock 进行单元测试",
      "- **核心工具**: vitest",
      "- **风险**: 低",
      "",
      "## 备选方案 A",
      "- **方法**: 使用 jest 进行集成测试",
      "- **核心工具**: jest",
      "- **风险**: 中",
      "",
      "## 备选方案 B",
      "- **方法**: 使用 mocha + chai 进行端到端测试",
      "- **核心工具**: mocha",
      "- **风险**: 高",
    ].join("\n");

    const result = parseApproachPlan(content);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result![0]).toEqual({ id: "primary", summary: "使用 vitest mock 进行单元测试", failCount: 0 });
    expect(result![1]).toEqual({ id: "alt-a", summary: "使用 jest 进行集成测试", failCount: 0 });
    expect(result![2]).toEqual({ id: "alt-b", summary: "使用 mocha + chai 进行端到端测试", failCount: 0 });
  });

  it("returns null when only primary approach (no alternatives)", () => {
    const content = [
      "## 主方案",
      "- **方法**: 使用 vitest mock",
      "- **核心工具**: vitest",
    ].join("\n");

    const result = parseApproachPlan(content);
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseApproachPlan("")).toBeNull();
  });

  it("handles format variant with extra blank lines around headings", () => {
    const content = [
      "",
      "## 主方案",
      "",
      "- **方法**: 直接调用 API",
      "",
      "",
      "## 备选方案 A",
      "",
      "- **方法**: 通过代理层间接调用",
      "",
    ].join("\n");

    const result = parseApproachPlan(content);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].summary).toBe("直接调用 API");
    expect(result![1].summary).toBe("通过代理层间接调用");
  });

  it("returns null when content has no recognized headings (AC-6)", () => {
    const content = "这是一段普通文本，没有方案格式。\n随便写的内容。";
    expect(parseApproachPlan(content)).toBeNull();
  });

  // TC-01: Standard format with goal section, primary + 2 alternatives
  it("TC-01: parses standard format with goal + primary + 2 alternatives (AC-1)", () => {
    const content = [
      "## 目标",
      "为 Guide.vue 编写验证测试",
      "",
      "## 主方案",
      "- **方法**: 安装 vitest + @vue/test-utils，编写组件单元测试",
      "- **核心工具**: vitest, jsdom",
      "- **风险**: Node 版本可能不兼容",
      "",
      "## 备选方案 A",
      "- **方法**: 纯 Node.js 脚本，提取核心逻辑函数单独测试",
      "- **核心工具**: node (内置)",
      "- **适用**: 主方案安装失败时",
      "",
      "## 备选方案 B",
      "- **方法**: 编译验证 + 代码静态审查",
      "- **核心工具**: tsc, grep",
      "- **适用**: 无法运行任何测试框架时",
    ].join("\n");

    const result = parseApproachPlan(content);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result![0]).toEqual({ id: "primary", summary: "安装 vitest + @vue/test-utils，编写组件单元测试", failCount: 0 });
    expect(result![1]).toEqual({ id: "alt-a", summary: "纯 Node.js 脚本，提取核心逻辑函数单独测试", failCount: 0 });
    expect(result![2]).toEqual({ id: "alt-b", summary: "编译验证 + 代码静态审查", failCount: 0 });
  });

  // TC-02: Missing **方法** field uses fallback summary
  it("TC-02: missing method field uses section title as fallback summary (AC-1)", () => {
    const content = [
      "## 主方案",
      "- **核心工具**: vitest",
      "",
      "## 备选方案 A",
      "- **核心工具**: jest",
    ].join("\n");

    const result = parseApproachPlan(content);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].summary).toBe("主方案");
    expect(result![1].summary).toBe("备选方案 A");
  });

  // TC-10: Random text with no recognized headings
  it("TC-10: random text without any headings returns null (AC-6)", () => {
    const content = "这是一段无关的文本\n没有任何方案格式";
    expect(parseApproachPlan(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractOneLineReason (Task 7)
// ---------------------------------------------------------------------------

describe("extractOneLineReason", () => {
  it("extracts first line from long multi-line text", () => {
    const feedback = "编译失败：找不到模块\n详细信息：xxx\n堆栈跟踪：yyy";
    const result = extractOneLineReason(feedback);
    expect(result).toBe("编译失败：找不到模块");
  });

  it("returns short text as-is", () => {
    const feedback = "测试未通过";
    const result = extractOneLineReason(feedback);
    expect(result).toBe("测试未通过");
  });

  it("truncates first line longer than 120 characters", () => {
    const longLine = "A".repeat(150);
    const result = extractOneLineReason(longLine);
    expect(result).toBe("A".repeat(120) + "...");
    expect(result.length).toBe(123);
  });

  it("returns '未知原因' for empty string", () => {
    expect(extractOneLineReason("")).toBe("未知原因");
  });

  it("skips leading blank lines and returns first non-empty line", () => {
    const feedback = "\n\n  \n实际的错误信息\n更多细节";
    const result = extractOneLineReason(feedback);
    expect(result).toBe("实际的错误信息");
  });

  // TC-23: truncates super-long feedback (200 chars)
  it("TC-23: truncates 200-char first line to 123 chars", () => {
    const input = "A".repeat(200) + "\n第二行";
    const result = extractOneLineReason(input);
    expect(result).toBe("A".repeat(120) + "...");
    expect(result.length).toBe(123);
  });

  // TC-24: all-whitespace input
  it("TC-24: all-whitespace input returns '未知原因'", () => {
    expect(extractOneLineReason("   \n\n  \n  ")).toBe("未知原因");
  });
});

// ---------------------------------------------------------------------------
// buildCircuitBreakPrompt (Task 8)
// ---------------------------------------------------------------------------

describe("buildCircuitBreakPrompt", () => {
  it("includes goal and approach description", () => {
    const result = buildCircuitBreakPrompt({
      goal: "实现用户认证模块",
      approach: "使用 JWT token 方案",
      prohibited: [],
      outputDir: "/tmp/output",
    });

    expect(result).toContain("实现用户认证模块");
    expect(result).toContain("使用 JWT token 方案");
  });

  it("includes prohibited list with '禁止' keyword (AC-2)", () => {
    const result = buildCircuitBreakPrompt({
      goal: "实现功能",
      approach: "方案 B",
      prohibited: [
        { id: "primary", summary: "方案 A", failReason: "编译失败" },
      ],
      outputDir: "/tmp/output",
    });

    expect(result).toContain("禁止");
    expect(result).toContain("方案 A");
    expect(result).toContain("编译失败");
  });

  it("includes multiple prohibited approaches", () => {
    const result = buildCircuitBreakPrompt({
      goal: "实现功能",
      approach: "方案 C",
      prohibited: [
        { id: "primary", summary: "方案 A", failReason: "类型错误" },
        { id: "alt-a", summary: "方案 B", failReason: "依赖缺失" },
      ],
      outputDir: "/tmp/output",
    });

    expect(result).toContain("方案 A");
    expect(result).toContain("方案 B");
    expect(result).toContain("类型错误");
    expect(result).toContain("依赖缺失");
  });

  it("does not contain any framework terms (AC-7)", () => {
    const result = buildCircuitBreakPrompt({
      goal: "实现数据库迁移",
      approach: "使用 Prisma 迁移工具",
      prohibited: [
        { id: "primary", summary: "手动 SQL 迁移", failReason: "语法错误" },
      ],
      outputDir: "/tmp/output",
    });

    expect(containsFrameworkTerms(result)).toBe(false);
  });

  it("includes output directory", () => {
    const result = buildCircuitBreakPrompt({
      goal: "实现功能",
      approach: "方案 A",
      prohibited: [],
      outputDir: "/tmp/my-output",
    });

    expect(result).toContain("/tmp/my-output");
  });

  // TC-11: circuit break prompt with multiple prohibited approaches has no framework terms
  it("TC-11: multiple prohibited approaches still free of framework terms (AC-7)", () => {
    const result = buildCircuitBreakPrompt({
      goal: "实现数据库迁移功能",
      approach: "使用 Prisma 迁移工具进行 schema 同步",
      prohibited: [
        { id: "primary", summary: "手动编写 SQL DDL", failReason: "SQL 语法错误" },
        { id: "alt-a", summary: "使用 Knex 迁移", failReason: "依赖版本冲突" },
      ],
      outputDir: "/tmp/output",
    });

    expect(containsFrameworkTerms(result)).toBe(false);
    // Should not contain specific framework terms
    expect(result).not.toMatch(/checkpoint/i);
    expect(result).not.toMatch(/tribunal/i);
    expect(result).not.toMatch(/auto_dev_/i);
    expect(result).not.toMatch(/Phase\s+\d/i);
    expect(result).not.toMatch(/迭代限制/);
    expect(result).not.toMatch(/回退限制/);
    expect(result).not.toMatch(/\bsubmit\b/i);
    expect(result).not.toMatch(/\bpreflight\b/i);
    expect(result).not.toMatch(/\bmandate\b/i);
  });
});
