/**
 * HubClient Extended Unit Tests
 *
 * Covers new test cases from tribunal-hub-integration e2e test plan:
 *   - TC-H07: isAvailable timeout
 *   - TC-H16: empty token skips Authorization header
 *   - TC-H17: ensureConnected retry after failure
 *   - TC-H21: multiple workers — returns first online
 *   - TC-H24: executePrompt expired command
 *   - TC-H25: polling interval strategy (2s, 3s, 5s, 5s...)
 *   - TC-H26: polling continues after GET non-OK
 *   - TC-H27-H30: getHubClient singleton factory
 *   - TC-N01: trailing slash normalization
 *   - TC-N03: ensureConnected network error
 *   - TC-N04: empty TRIBUNAL_HUB_URL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, getHubClient, resetHubClient } from '../hub-client.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.resetAllMocks();
  resetHubClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(
  url = 'http://localhost:3100',
  token = 'test-token'
): HubClient {
  return new HubClient(url, token);
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// TC-H07: isAvailable timeout
// ---------------------------------------------------------------------------

describe('HubClient.isAvailable — timeout', () => {
  it('TC-H07: returns false when fetch exceeds 1s timeout', async () => {
    // Mock fetch that triggers the AbortController abort
    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      // Simulate a delayed response that respects abort signal
      return new Promise((_resolve, reject) => {
        const signal = opts?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          });
        }
        // Never resolve — wait for abort
      });
    });

    const client = makeClient();
    const result = await client.isAvailable();

    expect(result).toBe(false);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// TC-H16: empty token — no Authorization header
// ---------------------------------------------------------------------------

describe('HubClient.ensureConnected — empty token', () => {
  it('TC-H16: empty token does not send Authorization header', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'agent-1' }));
    const client = new HubClient('http://localhost:3100', '');

    await client.ensureConnected();

    const callArgs = mockFetch.mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TC-H17: ensureConnected retry after failure
// ---------------------------------------------------------------------------

describe('HubClient.ensureConnected — retry after failure', () => {
  it('TC-H17: registration failure then success — second call succeeds', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({}, 500);
      }
      return jsonResponse({ id: 'agent-1' });
    });

    const client = makeClient();
    const first = await client.ensureConnected();
    const second = await client.ensureConnected();

    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// TC-H21: multiple workers — first online
// ---------------------------------------------------------------------------

describe('HubClient.findTribunalWorker — multiple workers', () => {
  it('TC-H21: returns first online worker among multiple', async () => {
    const agents = [
      {
        id: 'w1',
        name: 'tribunal-worker',
        status: 'offline',
        capabilities: [],
      },
      { id: 'w2', name: 'tribunal-worker', status: 'online', capabilities: [] },
      { id: 'w3', name: 'tribunal-worker', status: 'online', capabilities: [] },
    ];
    mockFetch.mockResolvedValue(jsonResponse(agents));
    const client = makeClient();

    const worker = await client.findTribunalWorker();

    expect(worker).not.toBeNull();
    expect(worker!.id).toBe('w2');
  });
});

// ---------------------------------------------------------------------------
// TC-H24: executePrompt — expired command
// ---------------------------------------------------------------------------

describe('HubClient.executePrompt — expired command', () => {
  it('TC-H24: returns null when command status is expired', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && url.includes('/commands')) {
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      if (url.includes('/commands/cmd-1')) {
        return jsonResponse({ id: 'cmd-1', status: 'expired' });
      }
      return jsonResponse({}, 404);
    });

    const client = makeClient();
    const result = await client.executePrompt('w1', 'test prompt', 30_000);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-H25: polling interval strategy
// ---------------------------------------------------------------------------

describe('HubClient.executePrompt — polling intervals', () => {
  it('TC-H25: polling intervals follow 2s, 3s, 5s, 5s pattern', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    let pollCount = 0;

    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && url.includes('/commands')) {
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      if (url.includes('/commands/cmd-1')) {
        pollCount++;
        if (pollCount >= 5) {
          return jsonResponse({
            id: 'cmd-1',
            status: 'completed',
            result: { verdict: 'PASS', issues: [] },
          });
        }
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      return jsonResponse({}, 404);
    });

    const client = makeClient();
    await client.executePrompt('w1', 'prompt', 60_000);

    // Extract setTimeout delays used for polling (filter out non-polling timeouts)
    const delays = setTimeoutSpy.mock.calls
      .map(call => call[1])
      .filter((d): d is number => typeof d === 'number' && d >= 2000);

    // Should follow pattern: 2000, 3000, 5000, 5000, 5000
    expect(delays[0]).toBe(2000);
    expect(delays[1]).toBe(3000);
    expect(delays[2]).toBe(5000);
    expect(delays[3]).toBe(5000);

    setTimeoutSpy.mockRestore();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// TC-H26: polling continues after GET non-OK
// ---------------------------------------------------------------------------

describe('HubClient.executePrompt — resilient polling', () => {
  it('TC-H26: continues polling after GET returns non-OK, then completes', async () => {
    let pollCount = 0;

    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && url.includes('/commands')) {
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      if (url.includes('/commands/cmd-1')) {
        pollCount++;
        if (pollCount === 1) {
          return jsonResponse({}, 500); // First poll fails
        }
        return jsonResponse({
          id: 'cmd-1',
          status: 'completed',
          result: {
            verdict: 'FAIL',
            issues: [{ severity: 'P1', description: 'issue' }],
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const client = makeClient();
    const result = await client.executePrompt('w1', 'prompt', 30_000);

    expect(result).toEqual({
      verdict: 'FAIL',
      issues: [{ severity: 'P1', description: 'issue' }],
    });
    expect(pollCount).toBe(2);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// TC-H27-H30: getHubClient singleton factory
// ---------------------------------------------------------------------------

describe('getHubClient singleton factory', () => {
  it('TC-H27: returns null when TRIBUNAL_HUB_URL is not set', () => {
    delete process.env.TRIBUNAL_HUB_URL;

    const client = getHubClient();

    expect(client).toBeNull();
  });

  it('TC-H28: returns HubClient instance when TRIBUNAL_HUB_URL is set', () => {
    vi.stubEnv('TRIBUNAL_HUB_URL', 'http://localhost:3100');

    const client = getHubClient();

    expect(client).not.toBeNull();
    expect(client).toBeInstanceOf(HubClient);
  });

  it('TC-H29: consecutive calls return same instance (singleton)', () => {
    vi.stubEnv('TRIBUNAL_HUB_URL', 'http://localhost:3100');

    const first = getHubClient();
    const second = getHubClient();

    expect(first).toBe(second);
  });

  it('TC-H30: resetHubClient creates new instance on next call', () => {
    vi.stubEnv('TRIBUNAL_HUB_URL', 'http://localhost:3100');

    const first = getHubClient();
    resetHubClient();
    const second = getHubClient();

    expect(first).not.toBe(second);
    expect(second).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-N01: trailing slash normalization
// ---------------------------------------------------------------------------

describe('HubClient — URL normalization', () => {
  it('TC-N01: trailing slashes are stripped from baseUrl', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    const client = new HubClient('http://host:3100///', 'token');

    await client.isAvailable();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://host:3100/agents',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// TC-N03: ensureConnected network exception
// ---------------------------------------------------------------------------

describe('HubClient.ensureConnected — network exception', () => {
  it('TC-N03: TypeError does not throw, returns false', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const client = makeClient();

    const result = await client.ensureConnected();

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-N04: empty TRIBUNAL_HUB_URL
// ---------------------------------------------------------------------------

describe('getHubClient — empty string', () => {
  it('TC-N04: empty string TRIBUNAL_HUB_URL returns null', () => {
    vi.stubEnv('TRIBUNAL_HUB_URL', '');

    const client = getHubClient();

    expect(client).toBeNull();
  });
});
