// ---------------------------------------------------------------------------
// Centralized constants for the lessons scoring / eviction system
// ---------------------------------------------------------------------------
export const SCORE_INITIAL = { critical: 10, important: 6, minor: 3 };
export const SCORE_DELTA = { helpful: 3, not_applicable: -1, incorrect: -5 };
export const DECAY_PERIOD_DAYS = 30;
export const MAX_GLOBAL_POOL = 50;
export const MAX_GLOBAL_INJECT = 10;
export const MAX_FEEDBACK_HISTORY = 20;
export const MIN_DISPLACEMENT_MARGIN = 2;
// ---------------------------------------------------------------------------
// Helper: initial score based on severity
// ---------------------------------------------------------------------------
export function initialScore(severity) {
    if (severity === "critical")
        return SCORE_INITIAL.critical;
    if (severity === "important")
        return SCORE_INITIAL.important;
    return SCORE_INITIAL.minor;
}
// ---------------------------------------------------------------------------
// Helper: ensure legacy entries have all new fields with sensible defaults
// ---------------------------------------------------------------------------
export function ensureDefaults(entry) {
    return {
        ...entry,
        score: entry.score ?? initialScore(entry.severity),
        feedbackHistory: entry.feedbackHistory ?? [],
        retired: entry.retired ?? false,
    };
}
//# sourceMappingURL=lessons-constants.js.map