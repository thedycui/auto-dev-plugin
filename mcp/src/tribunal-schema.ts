/** JSON Schema for tribunal output — used with claude -p --json-schema */
export const TRIBUNAL_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["PASS", "FAIL"],
      description: "裁决结果。默认立场是 FAIL，PASS 需要充分证据。"
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          description: { type: "string" },
          file: { type: "string" },
          suggestion: { type: "string" }
        },
        required: ["severity", "description"]
      },
      description: "发现的问题列表"
    },
    traces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          status: { type: "string", enum: ["FIXED", "NOT_FIXED", "PARTIAL"] },
          evidence: { type: "string" }
        },
        required: ["source", "status"]
      },
      description: "Phase 1/2 回溯验证结果（仅 Phase 4）"
    },
    passEvidence: {
      type: "array",
      items: { type: "string" },
      description: "PASS 时必须提供的逐条证据（文件名:行号）。FAIL 时可为空。"
    }
  },
  required: ["verdict", "issues"]
};

/** Phases that require tribunal judgment */
export const TRIBUNAL_PHASES = [4, 5, 6] as const;
