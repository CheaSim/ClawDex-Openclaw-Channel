import { afterEach, describe, expect, it, vi } from "vitest";

import {
  default as plugin,
  callDebateTopicsSync,
  callControlPlane,
  getConfig,
  isValidMode,
  isConfigured,
  matchesField,
  normalizeText,
  resolveAgentIdByBindings,
  resolveRuntimeRootConfig,
  validatePositiveNumber,
} from "../plugin";

function registerGatewayMethods() {
  const handlers = new Map<string, (context: any) => Promise<void> | void>();

  plugin.register({
    registerChannel: vi.fn(),
    registerGatewayMethod: (name: string, handler: (context: any) => Promise<void> | void) => {
      handlers.set(name, handler);
    },
  } as any);

  return handlers;
}

const testRootConfig = {
  channels: {
    "clawdex-channel": {
      controlPlaneBaseUrl: "https://control-plane.example/api",
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("normalizeText", () => {
  it("trims whitespace and enforces the maximum length", () => {
    expect(normalizeText("  hello world  ", 5)).toBe("hello");
  });

  it("returns an empty string for non-string values", () => {
    expect(normalizeText(123)).toBe("");
  });
});

describe("validatePositiveNumber", () => {
  it("accepts finite positive numbers", () => {
    expect(validatePositiveNumber(20, "stake")).toEqual({ ok: true, value: 20 });
  });

  it("rejects zero and negative values", () => {
    expect(validatePositiveNumber(0, "stake")).toEqual({
      ok: false,
      error: "stake must be a positive number",
    });
  });
});

describe("isValidMode", () => {
  it("accepts supported battle modes", () => {
    expect(isValidMode("public-arena")).toBe(true);
    expect(isValidMode("rivalry")).toBe(true);
    expect(isValidMode("ranked-1v1")).toBe(true);
  });

  it("rejects unsupported battle modes", () => {
    expect(isValidMode("casual")).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
  });
});

describe("matchesField", () => {
  it("treats missing and wildcard expectations as a match", () => {
    expect(matchesField(undefined, "public-arena")).toBe(true);
    expect(matchesField("*", "public-arena")).toBe(true);
  });

  it("requires exact equality for concrete values", () => {
    expect(matchesField("public-arena", "public-arena")).toBe(true);
    expect(matchesField("public-arena", "ranked-1v1")).toBe(false);
  });
});

describe("resolveRuntimeRootConfig", () => {
  it("returns runtime cfg unchanged when it is already a root config", () => {
    const rootConfig = {
      channels: {
        "clawdex-channel": {
          controlPlaneBaseUrl: "https://control-plane.example/api",
        },
      },
      bindings: [{ agentId: "clawdex-main" }],
    };

    expect(resolveRuntimeRootConfig(rootConfig)).toEqual(rootConfig);
  });

  it("wraps channel-local config into the root config shape", () => {
    expect(resolveRuntimeRootConfig({
      controlPlaneBaseUrl: "https://control-plane.example/api",
      defaultAgentId: "clawdex-main",
    })).toEqual({
      channels: {
        "clawdex-channel": {
          controlPlaneBaseUrl: "https://control-plane.example/api",
          defaultAgentId: "clawdex-main",
        },
      },
    });
  });

  it("prefers the provided root config when runtime cfg is missing", () => {
    const rootConfig = {
      channels: {
        "clawdex-channel": {
          controlPlaneBaseUrl: "https://control-plane.example/api",
        },
      },
    };

    expect(resolveRuntimeRootConfig(undefined, rootConfig)).toEqual(rootConfig);
  });
});

describe("getConfig and isConfigured", () => {
  it("reads direct channel-local config", () => {
    const config = {
      controlPlaneBaseUrl: "https://control-plane.example/api",
      defaultMode: "public-arena" as const,
    };

    expect(getConfig(config)).toEqual(config);
    expect(isConfigured(config)).toBe(true);
  });

  it("reads nested config from the root channels map", () => {
    const rootConfig = {
      channels: {
        "clawdex-channel": {
          controlPlaneBaseUrl: "https://control-plane.example/api",
          defaultAgentId: "clawdex-ranked",
        },
      },
    };

    expect(getConfig(rootConfig)).toEqual({
      controlPlaneBaseUrl: "https://control-plane.example/api",
      defaultAgentId: "clawdex-ranked",
    });
  });

  it("returns an empty config and reports unconfigured when the channel is absent", () => {
    expect(getConfig({ channels: {} })).toEqual({});
    expect(isConfigured({ channels: {} })).toBe(false);
  });
});

describe("resolveAgentIdByBindings", () => {
  it("prefers an explicit agentId from params", () => {
    expect(resolveAgentIdByBindings({}, { agentId: "manual-agent" })).toBe("manual-agent");
  });

  it("selects the first binding that matches channel, mode, scope, and peer", () => {
    const cfg = {
      channels: {
        "clawdex-channel": {
          defaultAgentId: "fallback-agent",
        },
      },
      bindings: [
        {
          agentId: "wrong-channel",
          match: { channel: "other-channel", mode: "public-arena" },
        },
        {
          agentId: "group-ranked",
          match: {
            channel: "clawdex-channel",
            mode: "ranked-1v1",
            scope: "ladder",
            peer: { kind: "group", id: "room-42" },
          },
        },
      ],
    };

    expect(resolveAgentIdByBindings(cfg, {
      mode: "ranked-1v1",
      scope: "ladder",
      peerKind: "group",
      peerId: "room-42",
    })).toBe("group-ranked");
  });

  it("falls back to defaultAgentId when no binding matches", () => {
    const cfg = {
      channels: {
        "clawdex-channel": {
          defaultAgentId: "configured-fallback",
        },
      },
      bindings: [
        {
          agentId: "public-agent",
          match: { channel: "clawdex-channel", mode: "public-arena" },
        },
      ],
    };

    expect(resolveAgentIdByBindings(cfg, { mode: "ranked-1v1" })).toBe("configured-fallback");
  });

  it("uses the built-in mode fallback when no binding or default agent exists", () => {
    expect(resolveAgentIdByBindings({
      channels: {
        "clawdex-channel": {
          defaultMode: "ranked-1v1",
        },
      },
    }, {})).toBe("clawdex-ranked");

    expect(resolveAgentIdByBindings({
      channels: {
        "clawdex-channel": {},
      },
    }, {})).toBe("clawdex-main");
  });
});

describe("callControlPlane", () => {
  it("retries 5xx responses with exponential backoff and preserves a request ID", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "temporary outage" }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "still warming up" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const promise = callControlPlane(
      {
        controlPlaneBaseUrl: "https://control-plane.example/api",
        controlPlaneToken: "secret",
      },
      "/health",
      { method: "GET" },
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    const thirdHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Headers;
    const requestId = firstHeaders.get("X-Request-Id");

    expect(requestId).toBeTruthy();
    expect(secondHeaders.get("X-Request-Id")).toBe(requestId);
    expect(thirdHeaders.get("X-Request-Id")).toBe(requestId);
    expect(firstHeaders.get("Authorization")).toBe("Bearer secret");
  });

  it("includes the request ID when retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "server exploded" }), { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    let caughtError: Error | undefined;
    const promise = callControlPlane(
      {
        controlPlaneBaseUrl: "https://control-plane.example/api",
      },
      "/battles",
      { method: "POST", body: JSON.stringify({ mode: "public-arena" }) },
    ).catch((e: Error) => { caughtError = e; });

    await vi.advanceTimersByTimeAsync(7_000);
    await promise;
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toMatch(/\[requestId: .+\]/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("callDebateTopicsSync", () => {
  it("defaults invalid limits to 10 before sending the control-plane request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, topics: [] }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await callDebateTopicsSync(
      {
        controlPlaneBaseUrl: "https://control-plane.example/api",
      },
      0,
    );

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toBe(JSON.stringify({ limit: 10 }));
  });
});

describe("debate gateway methods", () => {
  it("debate.topics.sync rejects invalid limits before calling the helper", async () => {
    const handlers = registerGatewayMethods();
    const respond = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await handlers.get("clawdex-channel.debate.topics.sync")?.({
      cfg: testRootConfig,
      params: { limit: 0 },
      respond,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, { error: "limit must be a positive number" });
  });

  it("debate.create does not report a resolvedAgentId from the side A player slug", async () => {
    const handlers = registerGatewayMethods();
    const respond = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, debate: { id: "debate-1" } }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await handlers.get("clawdex-channel.debate.create")?.({
      cfg: testRootConfig,
      params: {
        challengeId: "challenge-1",
        topicId: "topic-1",
        sideAPlayerSlug: "player-a",
        sideBPlayerSlug: "player-b",
      },
      respond,
    });

    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      debate: { id: "debate-1" },
      channel: "clawdex-channel",
    });
  });

  it("debate.autoplay rejects invalid stakes before creating the challenge", async () => {
    const handlers = registerGatewayMethods();
    const respond = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await handlers.get("clawdex-channel.debate.autoplay")?.({
      cfg: testRootConfig,
      params: {
        challengerSlug: "player-a",
        defenderSlug: "player-b",
        topicId: "topic-1",
        stake: 0,
        arguments: { a: ["a1"], b: ["b1"] },
      },
      respond,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, { error: "stake must be a positive number" });
  });

  it("debate.autoplay defaults scheduledFor to immediate", async () => {
    const handlers = registerGatewayMethods();
    const respond = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, challenge: { id: "challenge-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, debate: { id: "debate-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await handlers.get("clawdex-channel.debate.autoplay")?.({
      cfg: testRootConfig,
      params: {
        challengerSlug: "player-a",
        defenderSlug: "player-b",
        topicId: "topic-1",
        arguments: { a: ["a1"], b: ["b1"] },
      },
      respond,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toContain('"scheduledFor":"immediate"');
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        challengeId: "challenge-1",
        debateId: "debate-1",
        channel: "clawdex-channel",
      }),
    );
  });
});
