---
name: auto-dev
description: "自治开发循环 — 从设计到测试通过的全自动闭环"
---

Invoke the `auto-dev` skill to start an autonomous development loop.

Parse the user's arguments to determine:
- If a file path is given (e.g., `@design.md`): use it as existing design, start from Phase 1 REVIEW
- If `--quick` is given: use Quick Mode (skip design + plan)
- If `--resume` is given: resume from last checkpoint
- If `--skip-design` is given with a plan file: start from Phase 3
- If `--phase N` is given: start from Phase N
- If `--dry-run` is given: only run Phase 1-2 (design + plan), then stop
- If `--interactive` is given: enable interactive mode (confirmations, user prompts for git dirty state)
- Default: fully automatic, zero confirmation
- Otherwise: start from Phase 1 DESIGN with the description as input
