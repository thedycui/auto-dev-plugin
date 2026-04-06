/**
 * hub-client.ts — HTTP client for Agent Communication Hub.
 *
 * Used by tribunal three-tier strategy (Level 1: Hub mode).
 * All methods are designed to fail gracefully — errors return null/false
 * instead of throwing, so the caller can degrade to Subagent mode.
 */
// ---------------------------------------------------------------------------
// HubClient
// ---------------------------------------------------------------------------
export class HubClient {
    baseUrl;
    token;
    _registered = false;
    _agentId = null;
    constructor(baseUrl, token) {
        // Strip trailing slash
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.token = token;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Check if the Hub is reachable (1s timeout, fast fail).
     * Returns true if Hub responds, false otherwise (never throws).
     */
    async isAvailable() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1000);
            try {
                const res = await fetch(`${this.baseUrl}/agents`, {
                    method: 'GET',
                    headers: this.authHeaders(),
                    signal: controller.signal,
                });
                return res.ok;
            }
            finally {
                clearTimeout(timeout);
            }
        }
        catch (e) {
            console.error(`[hub] isAvailable failed: ${e.message}`);
            return false;
        }
    }
    /**
     * Register this agent with the Hub (idempotent — only sends one request).
     * Returns true if registered, false if registration failed.
     */
    async ensureConnected() {
        if (this._registered)
            return true;
        try {
            const res = await fetch(`${this.baseUrl}/agents/register`, {
                method: 'POST',
                headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'auto-dev-tribunal-client',
                    capabilities: ['tribunal-client'],
                }),
            });
            if (res.ok) {
                const data = (await res.json());
                this._agentId = data.id ?? data.agentId ?? null;
                this._registered = true;
                return true;
            }
            return false;
        }
        catch (e) {
            console.error(`[hub] ensureConnected failed: ${e.message}`);
            return false;
        }
    }
    /**
     * Find an online tribunal worker agent by name.
     * Uses TRIBUNAL_HUB_WORKER env var if set, otherwise "tribunal-worker".
     * Returns the agent object or null if not found.
     */
    async findTribunalWorker() {
        const workerName = process.env.TRIBUNAL_HUB_WORKER || 'tribunal-worker';
        try {
            const res = await fetch(`${this.baseUrl}/agents?name=${encodeURIComponent(workerName)}`, { headers: this.authHeaders() });
            if (!res.ok)
                return null;
            const agents = (await res.json());
            // Find first online agent
            return agents.find(a => a.status === 'online') ?? null;
        }
        catch (e) {
            console.error(`[hub] findTribunalWorker failed: ${e.message}`);
            return null;
        }
    }
    /**
     * Send an execute_prompt command to a target agent and poll until completion.
     * Returns the command result, or null on timeout/error.
     *
     * Polling strategy: 2s, 3s, 5s, 5s, ... (stabilizes at 5s).
     * Total timeout: timeoutMs (default 600_000 = 10 minutes).
     */
    async executePrompt(targetAgentId, prompt, timeoutMs = 600_000) {
        try {
            // 1. Send command
            const createRes = await fetch(`${this.baseUrl}/commands`, {
                method: 'POST',
                headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetAgentId,
                    action: 'execute_prompt',
                    payload: { prompt },
                }),
            });
            if (!createRes.ok)
                return null;
            const cmd = (await createRes.json());
            const commandId = cmd.id;
            // 2. Poll for completion
            const intervals = [2000, 3000, 5000]; // then stabilize at 5000
            let elapsed = 0;
            let pollIndex = 0;
            while (elapsed < timeoutMs) {
                const interval = intervals[Math.min(pollIndex, intervals.length - 1)];
                await new Promise(r => setTimeout(r, interval));
                elapsed += interval;
                pollIndex++;
                const statusRes = await fetch(`${this.baseUrl}/commands/${commandId}`, {
                    headers: this.authHeaders(),
                });
                if (!statusRes.ok)
                    continue;
                const statusData = (await statusRes.json());
                if (statusData.status === 'completed') {
                    return statusData.result;
                }
                if (statusData.status === 'rejected' ||
                    statusData.status === 'expired') {
                    return null;
                }
                // pending / assigned / in_progress — continue polling
            }
            // Timeout
            return null;
        }
        catch (e) {
            console.error(`[hub] executePrompt failed: ${e.message}`);
            return null;
        }
    }
    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------
    authHeaders() {
        if (this.token) {
            return { Authorization: `Bearer ${this.token}` };
        }
        return {};
    }
}
// ---------------------------------------------------------------------------
// Singleton factory (lazy, based on env vars)
// ---------------------------------------------------------------------------
let _hubClient = null;
/**
 * Get the HubClient singleton (or null if TRIBUNAL_HUB_URL is not set).
 */
export function getHubClient() {
    const hubUrl = process.env.TRIBUNAL_HUB_URL;
    if (!hubUrl)
        return null;
    if (!_hubClient) {
        const token = process.env.TRIBUNAL_HUB_TOKEN ?? '';
        _hubClient = new HubClient(hubUrl, token);
    }
    return _hubClient;
}
/**
 * Reset the singleton (for testing).
 */
export function resetHubClient() {
    _hubClient = null;
}
//# sourceMappingURL=hub-client.js.map