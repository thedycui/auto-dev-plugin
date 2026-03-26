/**
 * Tests for orchestrator-prompts.ts — feedback translation layer.
 */

import { describe, it, expect } from "vitest";
import {
  containsFrameworkTerms,
  buildRevisionPrompt,
  translateFailureToFeedback,
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

  it("includes previousAttemptSummary when provided", () => {
    const result = buildRevisionPrompt({
      originalTask: "实现功能",
      feedback: "有问题",
      artifacts: [],
      previousAttemptSummary: "上次缺少错误处理",
    });
    expect(result).toContain("上次缺少错误处理");
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
