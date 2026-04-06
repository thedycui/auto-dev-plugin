/**
 * HubClient Unit Tests
 *
 * Covers:
 *   - isAvailable(): success, timeout, network error (AC-3)
 *   - ensureConnected(): idempotent registration (AC-7)
 *   - findTribunalWorker(): found / not found (AC-4)
 *   - executePrompt(): normal completion, timeout, rejected (AC-2, AC-6)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, resetHubClient } from '../hub-client.js';

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

function makeClient(): HubClient {
  return new HubClient('http://localhost:3100', 'test-token');
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
// isAvailable
// ---------------------------------------------------------------------------

describe('HubClient.isAvailable', () => {
  it('returns true when Hub responds OK', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    const client = makeClient();

    const result = await client.isAvailable();

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns false on network error (AC-3)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = makeClient();

    const result = await client.isAvailable();

    expect(result).toBe(false);
  });

  it('returns false on non-OK status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    const client = makeClient();

    const result = await client.isAvailable();

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureConnected
// ---------------------------------------------------------------------------

describe('HubClient.ensureConnected', () => {
  it('registers successfully', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'agent-123' }));
    const client = makeClient();

    const result = await client.ensureConnected();

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/agents/register',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('is idempotent — second call does not send another request (AC-7)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'agent-123' }));
    const client = makeClient();

    await client.ensureConnected();
    await client.ensureConnected();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns false on registration failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    const client = makeClient();

    const result = await client.ensureConnected();

    expect(result).toBe(false);
  });

  it('sends Authorization header with token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'agent-123' }));
    const client = makeClient();

    await client.ensureConnected();

    const callArgs = mockFetch.mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });
});

// ---------------------------------------------------------------------------
// findTribunalWorker
// ---------------------------------------------------------------------------

describe('HubClient.findTribunalWorker', () => {
  it('returns online worker agent', async () => {
    const agents = [
      { id: 'w1', name: 'tribunal-worker', status: 'online', capabilities: [] },
    ];
    mockFetch.mockResolvedValue(jsonResponse(agents));
    const client = makeClient();

    const worker = await client.findTribunalWorker();

    expect(worker).not.toBeNull();
    expect(worker!.id).toBe('w1');
  });

  it('returns null when no worker found (AC-4)', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    const client = makeClient();

    const worker = await client.findTribunalWorker();

    expect(worker).toBeNull();
  });

  it('returns null when worker is offline', async () => {
    const agents = [
      {
        id: 'w1',
        name: 'tribunal-worker',
        status: 'offline',
        capabilities: [],
      },
    ];
    mockFetch.mockResolvedValue(jsonResponse(agents));
    const client = makeClient();

    const worker = await client.findTribunalWorker();

    expect(worker).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const client = makeClient();

    const worker = await client.findTribunalWorker();

    expect(worker).toBeNull();
  });

  it('uses TRIBUNAL_HUB_WORKER env var for worker name', async () => {
    vi.stubEnv('TRIBUNAL_HUB_WORKER', 'my-custom-worker');
    mockFetch.mockResolvedValue(jsonResponse([]));
    const client = makeClient();

    await client.findTribunalWorker();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/agents?name=my-custom-worker',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// executePrompt
// ---------------------------------------------------------------------------

describe('HubClient.executePrompt', () => {
  it('sends command and polls until completed (AC-2)', async () => {
    let pollCount = 0;
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && url.includes('/commands')) {
        // POST /commands
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      if (url.includes('/commands/cmd-1')) {
        pollCount++;
        // First poll: completed immediately
        return jsonResponse({
          id: 'cmd-1',
          status: 'completed',
          result: { verdict: 'PASS', issues: [] },
        });
      }
      return jsonResponse({}, 404);
    });

    const client = makeClient();
    const result = await client.executePrompt('w1', 'test prompt', 30_000);

    expect(result).toEqual({ verdict: 'PASS', issues: [] });
    expect(pollCount).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it('returns null on command creation failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    const client = makeClient();

    const result = await client.executePrompt('w1', 'test prompt', 5_000);

    expect(result).toBeNull();
  });

  it('returns null on timeout (AC-6)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/commands') && !url.includes('/commands/')) {
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      // Always return pending
      return jsonResponse({ id: 'cmd-1', status: 'pending' });
    });

    const client = makeClient();
    // Use very short timeout to avoid slow test
    const result = await client.executePrompt('w1', 'test prompt', 100);

    expect(result).toBeNull();
  }, 10_000);

  it('returns null when command is rejected', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes('/commands') && !url.includes('/commands/')) {
        return jsonResponse({ id: 'cmd-1', status: 'pending' });
      }
      return jsonResponse({ id: 'cmd-1', status: 'rejected' });
    });

    const client = makeClient();
    const result = await client.executePrompt('w1', 'test prompt', 30_000);

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const client = makeClient();

    const result = await client.executePrompt('w1', 'test prompt', 5_000);

    expect(result).toBeNull();
  });
});
