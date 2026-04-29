import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
