/**
 * Phase Enforcer — 强制 auto-dev 流程按顺序执行。
 *
 * 1. computeNextDirective: checkpoint 返回值中带下一步指令
 * 2. validateCompletion: 完成门禁，检查所有必需 Phase 是否已通过
 */

import type { StateJson } from "./types.js";

/** Phase 元数据 */
const PHASE_META: Record<number, { name: string; description: string }> = {
  1: { name: "DESIGN", description: "设计审查" },
  2: { name: "PLAN", description: "实施计划" },
  3: { name: "EXECUTE", description: "代码实施" },
  4: { name: "VERIFY", description: "编译测试验证" },
  5: { name: "E2E_TEST", description: "端到端测试" },
  6: { name: "ACCEPTANCE", description: "验收" },
};

/** full 模式的必需 Phase */
const REQUIRED_PHASES_FULL = [1, 2, 3, 4, 5, 6];

/** quick 模式的必需 Phase */
const REQUIRED_PHASES_QUICK = [3, 4, 5];

export interface NextDirective {
  /** 当前 Phase 是否已完成 */
  phaseCompleted: boolean;
  /** 下一个必须执行的 Phase 编号（null 表示全部完成） */
  nextPhase: number | null;
  /** 下一个 Phase 的名称 */
  nextPhaseName: string | null;
  /** 强制指令文本 — 必须在 checkpoint 返回值中展示给 Claude */
  mandate: string;
  /** 是否可以宣称任务完成 */
  canDeclareComplete: boolean;
}

/**
 * 根据当前 checkpoint 的 phase 和 status，计算下一步强制指令。
 */
export function computeNextDirective(
  currentPhase: number,
  status: string,
  state: StateJson,
): NextDirective {
  const mode = state.mode;
  const isDryRun = state.dryRun === true;
  const maxPhase = isDryRun ? 2 : 6;

  // 非 PASS 状态不推进
  if (status !== "PASS" && status !== "COMPLETED") {
    return {
      phaseCompleted: false,
      nextPhase: currentPhase,
      nextPhaseName: PHASE_META[currentPhase]?.name ?? `Phase ${currentPhase}`,
      mandate: `Phase ${currentPhase} 状态为 ${status}，需要修复后重新检查。`,
      canDeclareComplete: false,
    };
  }

  const nextPhase = currentPhase + 1;

  // 已到达最大 Phase
  if (nextPhase > maxPhase) {
    return {
      phaseCompleted: true,
      nextPhase: null,
      nextPhaseName: null,
      mandate: `所有 Phase 已完成。请调用 auto_dev_complete 确认完成。`,
      canDeclareComplete: true,
    };
  }

  const nextMeta = PHASE_META[nextPhase];
  return {
    phaseCompleted: true,
    nextPhase,
    nextPhaseName: nextMeta?.name ?? `Phase ${nextPhase}`,
    mandate: `[MANDATORY] Phase ${currentPhase} 已通过。必须立即执行 Phase ${nextPhase} (${nextMeta?.description ?? ""})。` +
      ` 调用 auto_dev_preflight(phase=${nextPhase}) 开始。` +
      ` 禁止跳过，禁止向用户宣称任务完成。`,
    canDeclareComplete: false,
  };
}

export interface CompletionValidation {
  /** 是否可以完成 */
  canComplete: boolean;
  /** 已通过的 Phase 列表 */
  passedPhases: number[];
  /** 缺失的 Phase 列表 */
  missingPhases: number[];
  /** 验证消息 */
  message: string;
}

/**
 * 验证是否所有必需 Phase 都已完成。
 * 通过解析 progress-log.md 中的 CHECKPOINT 注释来判断。
 */
export function validateCompletion(
  progressLogContent: string,
  mode: "full" | "quick",
  isDryRun: boolean,
): CompletionValidation {
  const requiredPhases = isDryRun
    ? [1, 2]
    : mode === "quick"
      ? REQUIRED_PHASES_QUICK
      : REQUIRED_PHASES_FULL;

  // 从 progress-log 中提取所有 PASS 的 phase
  const passedPhases = new Set<number>();
  const checkpointRegex = /<!-- CHECKPOINT phase=(\d+).*?status=PASS/g;
  let match;
  while ((match = checkpointRegex.exec(progressLogContent)) !== null) {
    passedPhases.add(parseInt(match[1], 10));
  }

  const missingPhases = requiredPhases.filter((p) => !passedPhases.has(p));

  if (missingPhases.length === 0) {
    return {
      canComplete: true,
      passedPhases: Array.from(passedPhases).sort(),
      missingPhases: [],
      message: "所有必需 Phase 已通过，可以完成。",
    };
  }

  const missingNames = missingPhases
    .map((p) => `Phase ${p} (${PHASE_META[p]?.name ?? "unknown"})`)
    .join(", ");

  return {
    canComplete: false,
    passedPhases: Array.from(passedPhases).sort(),
    missingPhases,
    message: `不能完成：以下 Phase 未通过: ${missingNames}。必须按顺序执行所有 Phase。`,
  };
}
