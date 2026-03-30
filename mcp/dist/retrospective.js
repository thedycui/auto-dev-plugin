/**
 * Retrospective — Phase 7 auto-extraction of lessons from a completed session.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { LessonsManager } from "./lessons-manager.js";
export async function runRetrospective(state, outputDir, projectRoot) {
    const lessons = new LessonsManager(outputDir, projectRoot);
    let extracted = 0;
    const progressLog = await safeRead(join(outputDir, "progress-log.md"));
    const codeReview = await safeRead(join(outputDir, "code-review.md"));
    const testResults = await safeRead(join(outputDir, "e2e-test-results.md"));
    // Pitfalls from NEEDS_REVISION
    for (const m of progressLog.matchAll(/CHECKPOINT phase=(\d+).*?status=NEEDS_REVISION/g)) {
        await lessons.add(Number(m[1]), "pitfall", `Phase ${m[1]} required revision`, undefined, {
            severity: "important", reusable: true, topic: state.topic,
        });
        extracted++;
    }
    // Pitfalls from BLOCKED
    for (const m of progressLog.matchAll(/CHECKPOINT phase=(\d+).*?status=BLOCKED/g)) {
        await lessons.add(Number(m[1]), "pitfall", `Phase ${m[1]} was blocked`, undefined, {
            severity: "critical", reusable: true, topic: state.topic,
        });
        extracted++;
    }
    // Code review P0/P1
    if (codeReview) {
        for (const m of codeReview.matchAll(/\*\*P0\*\*[:\s]*(.+)/gi)) {
            await lessons.add(4, "pitfall", `Code review P0: ${m[1].trim().slice(0, 200)}`, undefined, {
                severity: "critical", reusable: false, topic: state.topic,
            });
            extracted++;
        }
        for (const m of codeReview.matchAll(/\*\*P1\*\*[:\s]*(.+)/gi)) {
            await lessons.add(4, "pitfall", `Code review P1: ${m[1].trim().slice(0, 200)}`, undefined, {
                severity: "important", reusable: false, topic: state.topic,
            });
            extracted++;
        }
    }
    // Test failures
    if (testResults) {
        for (const m of testResults.matchAll(/FAIL[:\s]*(.+)/gi)) {
            await lessons.add(5, "pitfall", `Test failure: ${m[1].trim().slice(0, 200)}`, undefined, {
                severity: "important", reusable: false, topic: state.topic,
            });
            extracted++;
        }
    }
    // Highlights: one-shot passes
    const phaseTimings = state.phaseTimings ?? {};
    for (const [phase] of Object.entries(phaseTimings)) {
        if (!new RegExp(`CHECKPOINT phase=${phase}.*?status=NEEDS_REVISION`).test(progressLog)) {
            await lessons.add(Number(phase), "highlight", `Phase ${phase} passed on first attempt`, undefined, {
                severity: "minor", reusable: false, topic: state.topic,
            });
            extracted++;
        }
    }
    // Process: slow phases
    for (const [phase, timing] of Object.entries(phaseTimings)) {
        if (timing.durationMs && timing.durationMs > 10 * 60 * 1000) {
            const mins = Math.round(timing.durationMs / 60000);
            await lessons.add(Number(phase), "process", `Phase ${phase} took ${mins} minutes — consider scope reduction`, undefined, {
                severity: "minor", reusable: true, topic: state.topic,
            });
            extracted++;
        }
    }
    const promoted = await lessons.promoteReusableLessons(state.topic);
    const retrospectivePath = join(outputDir, "retrospective.md");
    const content = generateRetrospectiveDoc(state, extracted, promoted, progressLog);
    await mkdir(dirname(retrospectivePath), { recursive: true });
    await writeFile(retrospectivePath, content, "utf-8");
    return { lessonsExtracted: extracted, globalPromoted: promoted, retrospectivePath };
}
function generateRetrospectiveDoc(state, extracted, promoted, progressLog) {
    const timings = state.phaseTimings ?? {};
    const NAMES = { "0": "BRAINSTORM", "1": "DESIGN", "2": "PLAN", "3": "EXECUTE", "4": "VERIFY", "5": "E2E_TEST", "6": "ACCEPTANCE" };
    let doc = `# auto-dev 回顾总结 (Retrospective)\n\n`;
    doc += `**Topic**: ${state.topic}  \n**Generated**: ${new Date().toISOString()}  \n`;
    doc += `**Lessons extracted**: ${extracted} | **Global promoted**: ${promoted}\n\n`;
    doc += `## Phase 执行概况\n\n| Phase | 耗时 | 迭代 | 结果 |\n|-------|------|------|------|\n`;
    for (const [p, t] of Object.entries(timings)) {
        const dur = t.durationMs ? `${Math.round(t.durationMs / 1000)}s` : "—";
        const revs = (progressLog.match(new RegExp(`CHECKPOINT phase=${p}.*?status=NEEDS_REVISION`, "g")) ?? []).length;
        doc += `| ${p} (${NAMES[p] ?? "?"}) | ${dur} | ${revs > 0 ? revs + " 次修订" : "一次通过"} | ${t.completedAt ? "PASS" : "未完成"} |\n`;
    }
    doc += `\n## 踩坑记录\n\n`;
    const revs = [...progressLog.matchAll(/CHECKPOINT phase=(\d+).*?status=NEEDS_REVISION/g)];
    const blks = [...progressLog.matchAll(/CHECKPOINT phase=(\d+).*?status=BLOCKED/g)];
    if (revs.length === 0 && blks.length === 0) {
        doc += `全部一次通过！\n`;
    }
    else {
        for (const m of revs)
            doc += `- Phase ${m[1]} 需要修订\n`;
        for (const m of blks)
            doc += `- Phase ${m[1]} 被阻塞\n`;
    }
    doc += `\n## 流程改进建议\n\n`;
    let has = false;
    for (const [p, t] of Object.entries(timings)) {
        if (t.durationMs && t.durationMs > 10 * 60 * 1000) {
            doc += `- Phase ${p} 耗时 ${Math.round(t.durationMs / 60000)} 分钟\n`;
            has = true;
        }
    }
    if (!has)
        doc += `各 Phase 耗时均在合理范围内。\n`;
    doc += `\n## 全局经验\n\n共 ${promoted} 条经验已提升为全局可复用。\n`;
    doc += `\n---\n> 由 auto-dev Phase 7 (RETROSPECTIVE) 自动生成\n`;
    return doc;
}
async function safeRead(path) {
    try {
        return await readFile(path, "utf-8");
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=retrospective.js.map