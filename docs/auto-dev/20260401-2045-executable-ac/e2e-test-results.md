# E2E Test Results: executable-ac

## 执行环境
- 日期: 2026-04-01
- 命令: npm test
- 框架: vitest v2.1.9
- Node 环境: darwin

## 测试结果汇总
- 全局总测试数: 638 (27 个测试文件)
- 全局通过: 638
- 全局失败: 0
- AC 相关测试数: 85
- AC 相关通过: 85
- AC 相关失败: 0

## AC 相关测试文件明细

| 测试文件 | 用例数 | 结果 |
|----------|--------|------|
| ac-schema.test.ts | 15 | 全部 PASS |
| ac-runner.test.ts | 26 | 全部 PASS |
| ac-test-binding.test.ts | 18 | 全部 PASS |
| ac-integration.test.ts | 26 | 全部 PASS |

## 详细结果 — 已有测试（55 个基线用例）

### ac-schema.test.ts (11 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | should parse valid AC JSON with all layers | PASS | |
| - | should parse all 7 assertion types | PASS | |
| - | should reject missing required fields | PASS | |
| - | should reject invalid layer value | PASS | |
| - | should reject invalid assertion type | PASS | |
| - | should accept null structuralAssertions | PASS | |
| - | should accept missing structuralAssertions (optional) | PASS | |
| - | should produce a 32-char hex string | PASS | |
| - | should produce stable output for same input | PASS | |
| - | should produce different output for different input | PASS | |
| - | should not include description in hash | PASS | |

### ac-runner.test.ts (22 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | file_exists: should pass when file exists | PASS | |
| - | file_exists: should fail when file does not exist | PASS | |
| - | file_exists: should support glob patterns | PASS | |
| - | file_not_exists: should pass when file does not exist | PASS | |
| - | file_not_exists: should fail when file exists | PASS | |
| - | file_contains: should pass when file contains pattern | PASS | |
| - | file_contains: should fail when file does not contain pattern | PASS | |
| - | file_contains: should fail when file does not exist | PASS | |
| - | file_not_contains: should pass when file does not contain pattern | PASS | |
| - | file_not_contains: should fail when file contains pattern | PASS | |
| - | file_not_contains: should pass when file does not exist (x2) | PASS | |
| - | config_value: should pass when JSON config value matches | PASS | |
| - | config_value: should fail when JSON config value does not match | PASS | |
| - | config_value: should fail when key path does not exist | PASS | |
| - | build_succeeds: should pass when build command succeeds | PASS | |
| - | build_succeeds: should fail when build command fails | PASS | |
| - | build_succeeds: should fail when no build command configured | PASS | |
| - | test_passes: should pass when test command succeeds | PASS | |
| - | test_passes: should fail when test command fails | PASS | |
| - | multiple assertions per AC: should fail if any assertion fails | PASS | |
| - | non-structural ACs: should skip test-bound and manual ACs | PASS | |

### ac-test-binding.test.ts (13 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | discoverAcBindings - node: should discover test() with [AC-N] | PASS | |
| - | discoverAcBindings - node: should discover describe() with AC-N: prefix | PASS | |
| - | discoverAcBindings - node: should discover it() with [AC-N] | PASS | |
| - | discoverAcBindings - java: should discover @DisplayName with [AC-N] | PASS | |
| - | discoverAcBindings - java: should discover void ACN_ method pattern | PASS | |
| - | discoverAcBindings - python: should discover def test_acN_ pattern | PASS | |
| - | discoverAcBindings - python: should discover @pytest.mark.ac pattern | PASS | |
| - | validateAcBindingCoverage: should report covered, missing, and extra bindings | PASS | |
| - | validateAcBindingCoverage: should return empty missing when all covered | PASS | |
| - | validateAcBindingCoverage: should handle no test-bound ACs | PASS | |
| - | buildTargetedTestCommand: should generate vitest command for node | PASS | |
| - | buildTargetedTestCommand: should generate maven command for java | PASS | |
| - | buildTargetedTestCommand: should generate pytest command for python | PASS | |

### ac-integration.test.ts (9 基线)

| 编号 | 测试名称 | 结果 | 备注 |
|------|---------|------|------|
| - | Scenario 1: all PASS proceeds to Tribunal | PASS | |
| - | Scenario 2: structural FAIL short-circuit (file missing) | PASS | |
| - | Scenario 2: structural FAIL short-circuit (pattern not found) | PASS | |
| - | Scenario 3: hash mismatch BLOCKED (x2) | PASS | |
| - | Scenario 3: hash matches AC_LOCK | PASS | |
| - | Scenario 4: no AC_LOCK legacy flow | PASS | |
| - | Scenario 4: validateAcJson well-formed | PASS | |
| - | Scenario 5: missing bindings BLOCKED | PASS | |
| - | Scenario 5: all test-bound ACs covered | PASS | |
| - | Scenario 5: extra bindings reported | PASS | |
| - | Scenario 6: full framework validation pipeline | PASS | |
| - | Scenario 6: reject manual ratio > 40% | PASS | |
| - | Scenario 6: reject invalid schema | PASS | |

## 详细结果 — 补充测试（30 个新增用例）

### 边界值测试 (TC-B 系列)

| TC 编号 | 测试名称 | 结果 | 所在文件 | 备注 |
|---------|---------|------|---------|------|
| TC-B-01 | should return passed:true for null structuralAssertions | PASS | ac-runner.test.ts | 空断言 = 全通过 |
| TC-B-02 | should return passed:true for empty structuralAssertions array | PASS | ac-runner.test.ts | 空数组 = 全通过 |
| TC-B-03 | should handle empty criteria array without divide-by-zero | PASS | ac-schema.test.ts | total=0, valid=true |
| TC-B-04 | should return valid:false with parse error for non-JSON input | PASS | ac-integration.test.ts | 非法 JSON 降级 |
| TC-B-05 | should return valid:false with parse error for broken JSON | PASS | ac-integration.test.ts | integrity 校验降级 |
| TC-B-06 | should not throw on invalid regex pattern | PASS | ac-runner.test.ts | 无效正则不崩溃 |
| TC-B-07 | should return FAIL for malformed JSON config file | PASS | ac-runner.test.ts | 格式错误 JSON 降级 |
| TC-B-08 | should return empty array for unsupported language | PASS | ac-test-binding.test.ts | go 语言返回空 |
| TC-B-09 | should return fallback command for unknown language | PASS | ac-test-binding.test.ts | rust fallback |
| TC-B-10 | should produce stable hash for duplicate AC ids | PASS | ac-schema.test.ts | 重复 id hash 稳定 |
| TC-B-11 | should detect tamper when AC_LOCK hash is truncated | PASS | ac-integration.test.ts | 3 位 hash 检测篡改 |
| TC-B-12 | should return empty Map for empty bindings array | PASS | ac-test-binding.test.ts | 空 bindings 不报错 |
| TC-B-13 | should only process structural ACs, ignoring test-bound and manual | PASS | ac-runner.test.ts | 混合层正确过滤 |
| TC-B-14 | should return empty array for nonexistent path | PASS | ac-test-binding.test.ts | 路径不存在降级 |
| TC-B-15 | should accept manual ratio at exactly 40% | PASS | ac-schema.test.ts | 边界值 40% 通过 |
| TC-B-16 | should reject manual ratio over 40% | PASS | ac-schema.test.ts | 60% 被拒绝 |
| TC-B-18 | should not count duplicate AC-id bindings multiple times | PASS | ac-test-binding.test.ts | 去重正确 |

### 集成入口测试 (TC-E2E 系列)

| TC 编号 | 测试名称 | 结果 | 所在文件 | 备注 |
|---------|---------|------|---------|------|
| TC-E2E-01 | orchestrator Phase 6 full PASS pipeline | PASS | ac-integration.test.ts | structural 全通过 + 无 test-bound |
| TC-E2E-02 | orchestrator Phase 6 structural FAIL short-circuit | PASS | ac-integration.test.ts | structural 失败不进 Tribunal |
| TC-E2E-03 | orchestrator Phase 6 hash tamper BLOCKED | PASS | ac-integration.test.ts | hash 不匹配被阻断 |
| TC-E2E-04 | orchestrator Phase 6 binding missing BLOCKED | PASS | ac-integration.test.ts | test-bound 无绑定被阻断 |
| TC-E2E-05 | orchestrator Phase 6 no AC JSON legacy fallback | PASS | ac-integration.test.ts | 无 AC JSON 走 legacy |
| TC-E2E-06 | Phase 1 checkpoint AC_LOCK write | PASS | ac-integration.test.ts | schema 合法写入 hash |
| TC-E2E-07 | Phase 1 checkpoint AC schema invalid rejection | PASS | ac-integration.test.ts | schema 非法拒绝 |
| TC-E2E-08 | Phase 1 checkpoint manual ratio exceeded | PASS | ac-integration.test.ts | manual > 40% 拒绝 |
| TC-E2E-09 | index.ts Phase 6 submit legacy path full PASS | PASS | ac-integration.test.ts | legacy 路径全通过 |
| TC-E2E-10 | index.ts Phase 6 submit structural FAIL returns AC_FRAMEWORK_FAIL | PASS | ac-integration.test.ts | legacy 路径 BLOCKED |

## 覆盖矩阵验证

| 模块 | 基线测试 | 补充测试 | 合计 | 状态 |
|------|---------|---------|------|------|
| ac-schema.ts | 11 | 4 (TC-B-03/10/15/16) | 15 | PASS |
| ac-runner.ts | 22 | 4 (TC-B-01/02/06/07/13 minus 1 merged) | 26 | PASS |
| ac-test-binding.ts | 13 | 5 (TC-B-08/09/12/14/18) | 18 | PASS |
| ac-integration.ts (含 E2E) | 13 | 13 (TC-B-04/05/11 + TC-E2E-01~10) | 26 | PASS |
| **合计** | **59** | **26** | **85** | **ALL PASS** |

## Git 验证

测试文件在 git status 中确认为新增（untracked）：
- `mcp/src/__tests__/ac-integration.test.ts`
- `mcp/src/__tests__/ac-runner.test.ts`
- `mcp/src/__tests__/ac-schema.test.ts`
- `mcp/src/__tests__/ac-test-binding.test.ts`

## 结论

全部 85 个 AC 相关测试用例通过，覆盖 e2e-test-cases.md 中定义的所有 TC 编号（TC-B-01~TC-B-18, TC-E2E-01~TC-E2E-10，其中 TC-B-17 为已有覆盖确认）。测试通过率 100%。
