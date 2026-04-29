type JsonSchema = Record<string, unknown>;

type GatewayResponder = (ok: boolean, payload?: Record<string, unknown>) => void;

type GatewayMethodContext = {
  cfg: Record<string, any>;
  params?: Record<string, any>;
  respond: GatewayResponder;
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
};

type PluginApi = {
  config?: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registerChannel?: (input: { plugin: Record<string, unknown> }) => void;
  registerGatewayMethod?: (name: string, handler: (context: GatewayMethodContext) => Promise<void> | void) => void;
  logger?: {
    info?: (...args: unknown[]) => void;
  };
};

type ClawdexChannelConfig = {
  enabled?: boolean;
  gatewayBaseUrl?: string;
  gatewayToken?: string;
  controlPlaneBaseUrl?: string;
  controlPlaneToken?: string;
  defaultMode?: "public-arena" | "rivalry" | "ranked-1v1";
  readinessStrategy?: "control-plane" | "gateway";
  defaultAgentId?: string;
  requestTimeoutMs?: number;
};

type BattleMode = "public-arena" | "rivalry" | "ranked-1v1";

type BattleCreateParams = {
  challengerSlug: string;
  defenderSlug: string;
  mode?: BattleMode;
  stake: number;
  scheduledFor: string;
  visibility?: "public" | "followers";
  rulesNote?: string;
  peerKind?: "direct" | "group";
  peerId?: string;
  scope?: string;
  agentId?: string;
};

type BattleAcceptParams = {
  challengeId: string;
  defenderSlug?: string;
  sourceSessionId?: string;
  peerKind?: "direct" | "group";
  peerId?: string;
  scope?: string;
  agentId?: string;
};

type BattleSettleParams = {
  challengeId: string;
  winnerSlug: string;
  settlementSummary?: string;
  sourceSessionId?: string;
  mode?: BattleMode;
  peerKind?: "direct" | "group";
  peerId?: string;
  scope?: string;
  agentId?: string;
};

type AccountProvisionParams = {
  email?: string;
  name?: string;
  password?: string;
  preferredPlayerSlug?: string;
  playerName?: string;
  channel?: string;
  accountId?: string;
  region?: "CN" | "SEA" | "EU" | "NA";
  clientVersion?: string;
  notes?: string;
  openClawStatus?: "disconnected" | "configured" | "ready";
  autoReady?: boolean;
};

type CreditBalanceParams = {
  playerSlug?: string;
  email?: string;
};

type BattleAutoplayParams = BattleCreateParams & {
  challengerEmail?: string;
  challengerName?: string;
  challengerAccountId?: string;
  challengerChannel?: string;
  challengerRegion?: "CN" | "SEA" | "EU" | "NA";
  challengerClientVersion?: string;
  autoProvisionChallenger?: boolean;
  autoReady?: boolean;
};

type FullSelfTestParams = {
  challengerSlug?: string;
  challengerEmail?: string;
  challengerName?: string;
  defenderSlug?: string;
  defenderEmail?: string;
  defenderName?: string;
  mode?: BattleMode;
  stake?: number;
  visibility?: "public" | "followers";
  scheduledFor?: string;
  rulesNote?: string;
  autoReady?: boolean;
  settleWinner?: "challenger" | "defender";
  keepChallengeOpen?: boolean;
};

type BindingPeer = {
  kind?: "direct" | "group";
  id?: string;
};

type BindingMatch = {
  channel?: string;
  mode?: BattleMode | "*";
  scope?: string | "*";
  peer?: BindingPeer;
};

type Binding = {
  agentId: string;
  match?: BindingMatch;
};

type AgentResolutionParams = {
  mode?: BattleMode;
  scope?: string;
  peerKind?: "direct" | "group";
  peerId?: string;
  agentId?: string;
};

const CHANNEL_ID = "clawdex-channel";
const DEFAULT_STAKE = 20;
const DEFAULT_SCHEDULE = "immediate";
const DEFAULT_RULES_NOTE = "Created automatically by the OpenClaw plugin for integration testing.";
const MAX_TEXT_LENGTH = 2000;
const ALLOWED_MODES: BattleMode[] = ["public-arena", "rivalry", "ranked-1v1"];
const ALLOWED_VISIBILITIES: ("public" | "followers")[] = ["public", "followers"];

function isChannelLocalConfig(cfg: Record<string, any> | undefined): cfg is ClawdexChannelConfig {
  if (!cfg || typeof cfg !== "object") {
    return false;
  }

  return "controlPlaneBaseUrl" in cfg
    || "controlPlaneToken" in cfg
    || "gatewayBaseUrl" in cfg
    || "defaultMode" in cfg
    || "defaultAgentId" in cfg;
}

/**
 * Normalizes runtime config into the root OpenClaw config shape expected by this plugin.
 */
function resolveRuntimeRootConfig(
  cfg: Record<string, any> | undefined,
  rootCfg?: Record<string, any>,
): Record<string, any> {
  if (cfg && Object.keys(cfg).length > 0 && !isChannelLocalConfig(cfg)) {
    return cfg;
  }

  if (rootCfg) {
    return rootCfg;
  }

  if (cfg && isChannelLocalConfig(cfg)) {
    return {
      channels: {
        [CHANNEL_ID]: cfg,
      },
    };
  }

  return {};
}

/**
 * Extracts the Clawdex channel config from either root config or direct channel-local config.
 */
function getConfig(cfg: Record<string, any>): ClawdexChannelConfig {
  if (isChannelLocalConfig(cfg)) {
    return cfg;
  }

  return ((cfg?.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID] as ClawdexChannelConfig | undefined) ?? {};
}

function getEffectiveConfig(
  cfg: Record<string, any> | undefined,
  rootCfg?: Record<string, any>,
): ClawdexChannelConfig {
  return getConfig(resolveRuntimeRootConfig(cfg, rootCfg));
}

/**
 * Returns whether the minimum control-plane configuration is present.
 */
function isConfigured(cfg: Record<string, any>) {
  const config = getConfig(cfg);
  return Boolean(config.controlPlaneBaseUrl);
}

function getBindings(cfg: Record<string, any>) {
  return (Array.isArray(cfg?.bindings) ? cfg.bindings : []) as Binding[];
}

/**
 * Matches a binding field against a concrete runtime value, supporting missing and wildcard expectations.
 */
function matchesField(expected: string | undefined, actual: string | undefined) {
  if (!expected || expected === "*") {
    return true;
  }

  return expected === actual;
}

/**
 * Resolves the target agent id from explicit params, bindings, or the channel default agent id.
 */
function resolveAgentIdByBindings(cfg: Record<string, any>, params: AgentResolutionParams) {
  if (params.agentId) {
    return params.agentId;
  }

  const config = getConfig(cfg);
  const bindings = getBindings(cfg);

  for (const binding of bindings) {
    const match = binding.match;

    if (!binding.agentId) {
      continue;
    }

    if (!matchesField(match?.channel, CHANNEL_ID)) {
      continue;
    }

    if (!matchesField(match?.mode, params.mode)) {
      continue;
    }

    if (!matchesField(match?.scope, params.scope)) {
      continue;
    }

    if (!matchesField(match?.peer?.kind, params.peerKind)) {
      continue;
    }

    if (!matchesField(match?.peer?.id, params.peerId)) {
      continue;
    }

    return binding.agentId;
  }

  if (config.defaultAgentId) {
    return config.defaultAgentId;
  }

  return config.defaultMode === "ranked-1v1" ? "clawdex-ranked" : "clawdex-main";
}

/**
 * Trims unknown input into a bounded string, returning an empty string for non-string values.
 */
function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  const normalized = normalizeText(value, maxLength);
  return normalized || undefined;
}

/**
 * Validates a finite positive number and returns a tagged success or error payload.
 */
function validatePositiveNumber(value: unknown, field: string): { ok: boolean; value?: number; error?: string } {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (numeric === undefined || numeric <= 0) {
    return { ok: false, error: `${field} must be a positive number` };
  }
  return { ok: true, value: numeric };
}

/**
 * Checks whether a value is one of the supported battle modes.
 */
function isValidMode(mode: unknown): mode is BattleMode {
  return typeof mode === "string" && ALLOWED_MODES.includes(mode as BattleMode);
}

function isValidVisibility(visibility: unknown): visibility is "public" | "followers" {
  return visibility === "public" || visibility === "followers";
}

function requireConfig(config: ClawdexChannelConfig) {
  if (!config.controlPlaneBaseUrl) {
    throw new Error("channels.clawdex-channel.controlPlaneBaseUrl is required");
  }

  return config;
}

function buildControlPlaneUrl(config: ClawdexChannelConfig, path: string) {
  const baseUrl = (config.controlPlaneBaseUrl ?? "").replace(/\/$/, "");
  return `${baseUrl}${path}`;
}

function buildHeaders(config: ClawdexChannelConfig) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  if (config.controlPlaneToken) {
    headers.set("Authorization", `Bearer ${config.controlPlaneToken}`);
  }

  return headers;
}

async function readJsonSafely(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Core HTTP client for ClawDex control-plane calls.
 * Supports exponential-backoff retry (max 3 retries) for 5xx and network errors,
 * and attaches a persistent X-Request-Id header for debugging.
 */
async function callControlPlane(
  config: ClawdexChannelConfig,
  path: string,
  init: RequestInit,
  log?: GatewayMethodContext["log"],
) {
  const safeConfig = requireConfig(config);
  const url = buildControlPlaneUrl(safeConfig, path);
  const requestId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  log?.info?.(`[ClawdexPlugin] ${init.method ?? "GET"} ${url} [requestId: ${requestId}]`);

  const timeoutMs = config.requestTimeoutMs ?? 15_000;
  const maxRetries = 3;
  const backoffs = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = buildHeaders(safeConfig);
      headers.set("X-Request-Id", requestId);

      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      const payload = await readJsonSafely(response);

      if (!response.ok) {
        const status = response.status;
        const message = typeof payload.message === "string"
          ? payload.message
          : `Control plane request failed with HTTP ${status}`;
        const error: Error & { status?: number; payload?: Record<string, unknown> } = new Error(
          `[requestId: ${requestId}] ${message}`,
        );
        error.status = status;
        error.payload = payload;

        if (status >= 500 && attempt < maxRetries) {
          log?.warn?.(`[ClawdexPlugin] retrying after ${status} (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, backoffs[attempt]));
          continue;
        }
        throw error;
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (attempt < maxRetries) {
          log?.warn?.(`[ClawdexPlugin] timeout, retrying (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, backoffs[attempt]));
          continue;
        }
        throw new Error(`[requestId: ${requestId}] Control plane request timed out after ${timeoutMs}ms: ${url}`);
      }
      // Network errors — retry
      if (attempt < maxRetries) {
        log?.warn?.(`[ClawdexPlugin] network error, retrying (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, backoffs[attempt]));
        continue;
      }
      if (error instanceof Error) {
        if (!error.message.includes(`[requestId: ${requestId}]`)) {
          error.message = `[requestId: ${requestId}] ${error.message}`;
        }
        throw error;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Should never reach here, but TypeScript wants a return
  throw new Error(`[requestId: ${requestId}] Exhausted all retries for ${url}`);
}

async function callDiscovery(config: ClawdexChannelConfig, log?: GatewayMethodContext["log"]) {
  return callControlPlane(config, "/openclaw/plugin/discovery", { method: "GET" }, log);
}

async function callStatus(config: ClawdexChannelConfig, log?: GatewayMethodContext["log"]) {
  return callControlPlane(config, "/openclaw/plugin/status", { method: "GET" }, log);
}

async function callProvision(
  config: ClawdexChannelConfig,
  payload: Partial<AccountProvisionParams>,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    "/openclaw/plugin/accounts/provision",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    log,
  );
}

async function callReadiness(config: ClawdexChannelConfig, playerSlug: string, log?: GatewayMethodContext["log"]) {
  const query = new URLSearchParams({ playerSlug }).toString();
  return callControlPlane(config, `/openclaw/plugin/readiness?${query}`, { method: "GET" }, log);
}

async function callCredit(
  config: ClawdexChannelConfig,
  input: Partial<CreditBalanceParams>,
  log?: GatewayMethodContext["log"],
) {
  const query = new URLSearchParams();

  if (input.playerSlug) {
    query.set("playerSlug", input.playerSlug);
  }

  if (input.email) {
    query.set("email", input.email);
  }

  return callControlPlane(config, `/openclaw/plugin/credits?${query.toString()}`, { method: "GET" }, log);
}

async function callBattleCreate(
  config: ClawdexChannelConfig,
  payload: Partial<BattleCreateParams>,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    "/openclaw/plugin/challenges",
    {
      method: "POST",
      body: JSON.stringify({
        challengerSlug: payload.challengerSlug,
        defenderSlug: payload.defenderSlug,
        mode: payload.mode ?? config.defaultMode ?? "public-arena",
        stake: payload.stake,
        scheduledFor: payload.scheduledFor ?? DEFAULT_SCHEDULE,
        visibility: payload.visibility ?? "public",
        rulesNote: payload.rulesNote ?? DEFAULT_RULES_NOTE,
      }),
    },
    log,
  );
}

async function callBattleAccept(
  config: ClawdexChannelConfig,
  payload: Partial<BattleAcceptParams>,
  log?: GatewayMethodContext["log"],
) {
  const challengeId = normalizeText(payload.challengeId);

  return callControlPlane(
    config,
    `/openclaw/plugin/challenges/${challengeId}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        defenderSlug: payload.defenderSlug,
        sourceChannel: CHANNEL_ID,
        sourceSessionId: payload.sourceSessionId,
      }),
    },
    log,
  );
}

async function callBattleSettle(
  config: ClawdexChannelConfig,
  payload: Partial<BattleSettleParams>,
  log?: GatewayMethodContext["log"],
) {
  const challengeId = normalizeText(payload.challengeId);

  return callControlPlane(
    config,
    `/openclaw/plugin/challenges/${challengeId}/settle`,
    {
      method: "POST",
      body: JSON.stringify({
        winnerSlug: payload.winnerSlug,
        settlementSummary: payload.settlementSummary,
        sourceChannel: CHANNEL_ID,
        sourceSessionId: payload.sourceSessionId,
      }),
    },
    log,
  );
}

// ─── Debate PK Helper Functions ────────────────────────────

async function callDebateTopicsSync(
  config: ClawdexChannelConfig,
  limit: number,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    "/openclaw/plugin/debates/topics",
    { method: "POST", body: JSON.stringify({ limit }) },
    log,
  );
}

async function callDebateTopicsList(
  config: ClawdexChannelConfig,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(config, "/openclaw/plugin/debates/topics", { method: "GET" }, log);
}

async function callDebateCreate(
  config: ClawdexChannelConfig,
  payload: {
    challengeId: string;
    topicId: string;
    sideAPlayerSlug: string;
    sideBPlayerSlug: string;
    totalRounds?: number;
  },
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    "/openclaw/plugin/debates",
    { method: "POST", body: JSON.stringify(payload) },
    log,
  );
}

async function callDebateAction(
  config: ClawdexChannelConfig,
  debateId: string,
  action: "start" | "end",
  summary?: string,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    `/openclaw/plugin/debates/${debateId}`,
    { method: "POST", body: JSON.stringify({ action, summary }) },
    log,
  );
}

async function callDebateArgue(
  config: ClawdexChannelConfig,
  debateId: string,
  playerSlug: string,
  argument: string,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    `/openclaw/plugin/debates/${debateId}/argue`,
    { method: "POST", body: JSON.stringify({ playerSlug, argument }) },
    log,
  );
}

async function callDebateGet(
  config: ClawdexChannelConfig,
  debateId: string,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(
    config,
    `/openclaw/plugin/debates/${debateId}`,
    { method: "GET" },
    log,
  );
}

async function callDebateList(
  config: ClawdexChannelConfig,
  log?: GatewayMethodContext["log"],
) {
  return callControlPlane(config, "/openclaw/plugin/debates", { method: "GET" }, log);
}

async function runFullSelfTest(
  config: ClawdexChannelConfig,
  payload: Partial<FullSelfTestParams>,
  log?: GatewayMethodContext["log"],
) {
  const now = Date.now();
  const autoReady = payload.autoReady ?? true;
  const challengerName = normalizeText(payload.challengerName) || `SelfTest Challenger ${String(now).slice(-4)}`;
  const defenderName = normalizeText(payload.defenderName) || `SelfTest Defender ${String(now).slice(-4)}`;
  const challengerEmail = normalizeText(payload.challengerEmail) || `challenger-${now}@agents.clawdex.local`;
  const defenderEmail = normalizeText(payload.defenderEmail) || `defender-${now}@agents.clawdex.local`;

  const discovery = await callDiscovery(config, log);

  const challengerProvision = await callProvision(
    config,
    {
      email: challengerEmail,
      name: challengerName,
      preferredPlayerSlug: payload.challengerSlug,
      playerName: challengerName,
      channel: "Clawdex SelfTest Channel",
      accountId: `stc-${String(now).slice(-6)}`,
      clientVersion: "selftest",
      notes: "Created by clawdex-channel.selftest.full",
      autoReady,
      openClawStatus: autoReady ? "ready" : "configured",
    },
    log,
  );

  const resolvedChallengerSlug = normalizeText((challengerProvision.player as Record<string, unknown> | undefined)?.slug);

  const defenderProvision = await callProvision(
    config,
    {
      email: defenderEmail,
      name: defenderName,
      preferredPlayerSlug: payload.defenderSlug,
      playerName: defenderName,
      channel: "Clawdex SelfTest Channel",
      accountId: `std-${String(now).slice(-6)}`,
      clientVersion: "selftest",
      notes: "Created by clawdex-channel.selftest.full",
      autoReady,
      openClawStatus: autoReady ? "ready" : "configured",
    },
    log,
  );

  const resolvedDefenderSlug = normalizeText((defenderProvision.player as Record<string, unknown> | undefined)?.slug);

  if (!resolvedChallengerSlug || !resolvedDefenderSlug) {
    throw new Error("Self-test could not resolve both challengerSlug and defenderSlug");
  }

  const [challengerReadiness, defenderReadiness] = await Promise.all([
    callReadiness(config, resolvedChallengerSlug, log),
    callReadiness(config, resolvedDefenderSlug, log),
  ]);

  if (!challengerReadiness.ready || !defenderReadiness.ready) {
    throw new Error("Provisioned players are not ready. Check CLAWDEX_DATA_BACKEND=prisma and autoReady flow.");
  }

  const createdBattle = await callBattleCreate(
    config,
    {
      challengerSlug: resolvedChallengerSlug,
      defenderSlug: resolvedDefenderSlug,
      mode: payload.mode ?? config.defaultMode ?? "public-arena",
      stake: payload.stake ?? DEFAULT_STAKE,
      scheduledFor: payload.scheduledFor ?? DEFAULT_SCHEDULE,
      visibility: payload.visibility ?? "public",
      rulesNote: payload.rulesNote ?? DEFAULT_RULES_NOTE,
    },
    log,
  );

  const challenge = createdBattle.challenge as Record<string, unknown> | undefined;
  const challengeId = normalizeText(challenge?.id);

  if (!challengeId) {
    throw new Error("Self-test created battle but did not receive challengeId");
  }

  const acceptedBattle = await callBattleAccept(
    config,
    {
      challengeId,
      defenderSlug: resolvedDefenderSlug,
      sourceSessionId: `selftest-accept-${now}`,
    },
    log,
  );

  let settlement: Record<string, unknown> | null = null;

  if (!payload.keepChallengeOpen) {
    const settleWinner =
      payload.settleWinner === "defender"
        ? resolvedDefenderSlug
        : resolvedChallengerSlug;

    settlement = await callBattleSettle(
      config,
      {
        challengeId,
        winnerSlug: settleWinner,
        settlementSummary: `Self-test completed. Winner: ${settleWinner}`,
        sourceSessionId: `selftest-settle-${now}`,
      },
      log,
    );
  }

  const [challengerCredit, defenderCredit] = await Promise.all([
    callCredit(config, { playerSlug: resolvedChallengerSlug }, log),
    callCredit(config, { playerSlug: resolvedDefenderSlug }, log),
  ]);

  return {
    ok: true,
    channel: CHANNEL_ID,
    recommendedNextStep: payload.keepChallengeOpen ? "Run battle.settle after manual verification." : "Self-test complete. You can now create real battles.",
    flow: {
      discovery,
      challengerProvision,
      defenderProvision,
      challengerReadiness,
      defenderReadiness,
      createdBattle,
      acceptedBattle,
      settlement,
      challengerCredit,
      defenderCredit,
    },
    summary: {
      challengerSlug: resolvedChallengerSlug,
      defenderSlug: resolvedDefenderSlug,
      challengeId,
      settled: !payload.keepChallengeOpen,
    },
  };
}

const channelPlugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "Clawdex",
    selectionLabel: "Clawdex Battle Channel",
    docsPath: "/channels/clawdex-channel",
    docsLabel: "clawdex-channel",
    blurb: "Battle operations channel for OpenClaw, backed by the Clawdex control plane.",
    order: 90,
  },
  capabilities: {
    chatTypes: ["direct"],
    nativeCommands: false,
  },
  config: {
    listAccountIds: () => [],
    resolveAccount: (_cfg: Record<string, unknown>, accountId?: string | null) => ({
      accountId: accountId ?? "default",
      config: {},
      enabled: true,
      configured: true,
      name: "Clawdex Control Plane",
    }),
    defaultAccountId: () => "default",
    isConfigured: () => true,
    describeAccount: (account: { accountId?: string | null }) => ({
      accountId: account.accountId ?? "default",
      name: "Clawdex Control Plane",
      enabled: true,
      configured: true,
    }),
  },
  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        gatewayBaseUrl: { type: "string", description: "Optional custom OpenClaw Gateway base URL" },
        gatewayToken: { type: "string", description: "Optional Gateway token" },
        controlPlaneBaseUrl: { type: "string", description: "Required Clawdex control plane API base URL, for example http://127.0.0.1:3000/api" },
        controlPlaneToken: { type: "string", description: "Optional bearer token for Clawdex control plane" },
        defaultMode: { type: "string", enum: ["public-arena", "rivalry", "ranked-1v1"], default: "public-arena" },
        readinessStrategy: { type: "string", enum: ["control-plane", "gateway"], default: "control-plane" },
        defaultAgentId: { type: "string", description: "Fallback OpenClaw agent ID when no binding matches" },
      },
      required: ["controlPlaneBaseUrl"],
    } satisfies JsonSchema,
    uiHints: {
      enabled: { label: "Enable Clawdex Channel" },
      gatewayBaseUrl: { label: "Gateway Base URL" },
      controlPlaneBaseUrl: { label: "Clawdex API Base URL" },
      controlPlaneToken: { label: "Clawdex API Token", sensitive: true },
      defaultAgentId: { label: "Default Agent ID" },
    },
  },
  status: {
    probe: async ({ cfg }: { cfg: Record<string, any> }) => {
      if (!isConfigured(cfg)) {
        return { ok: false, error: "Clawdex controlPlaneBaseUrl is not configured" };
      }

      const config = getConfig(cfg);

      try {
        const payload = await callStatus(config);
        return {
          ok: true,
          details: {
            configured: true,
            controlPlaneBaseUrl: config.controlPlaneBaseUrl,
            readinessStrategy: config.readinessStrategy ?? "control-plane",
            remote: payload,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to reach Clawdex control plane",
        };
      }
    },
    buildChannelSummary: ({ snapshot }: { snapshot?: Record<string, unknown> }) => ({
      configured: snapshot?.configured ?? false,
      running: snapshot?.running ?? false,
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
    }),
  },
};

const plugin = {
  id: CHANNEL_ID,
  name: "Clawdex Channel",
  description: "OpenClaw battle channel backed by the Clawdex control plane",
  configSchema: {
    type: "object",
    additionalProperties: true,
    properties: {
      enabled: { type: "boolean", default: true },
    },
  },
  register(api: PluginApi) {
    const rootCfg = resolveRuntimeRootConfig(undefined, (api.config as Record<string, any> | undefined) ?? (api.pluginConfig as Record<string, any> | undefined));

    api.registerChannel?.({ plugin: channelPlugin });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.status`, async ({ respond, cfg }) => {
      const result = await channelPlugin.status.probe({ cfg: resolveRuntimeRootConfig(cfg, rootCfg) });
      respond(result.ok, result);
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.docs`, async ({ respond, cfg }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      respond(true, {
        ok: true,
        channel: CHANNEL_ID,
        configured: Boolean(config.controlPlaneBaseUrl),
        install: [
          "openclaw plugins install @cheasim/clawdex-channel",
          "configure channels.clawdex-channel.controlPlaneBaseUrl",
          "optionally set channels.clawdex-channel.controlPlaneToken",
          "invoke clawdex-channel.status",
          "invoke clawdex-channel.selftest.full",
        ],
        methods: [
          `${CHANNEL_ID}.status`,
          `${CHANNEL_ID}.docs`,
          `${CHANNEL_ID}.discovery`,
          `${CHANNEL_ID}.account.provision`,
          `${CHANNEL_ID}.battle.readiness`,
          `${CHANNEL_ID}.battle.create`,
          `${CHANNEL_ID}.battle.accept`,
          `${CHANNEL_ID}.battle.settle`,
          `${CHANNEL_ID}.credit.balance`,
          `${CHANNEL_ID}.selftest.quick`,
          `${CHANNEL_ID}.selftest.full`,
        ],
        examples: {
          selftestFull: {
            mode: "public-arena",
            stake: 20,
            autoReady: true,
            settleWinner: "challenger",
          },
        },
      });
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.agent.resolve`, async ({ respond, cfg, params }) => {
      const payload = params as AgentResolutionParams | undefined;
      const resolvedAgentId = resolveAgentIdByBindings(resolveRuntimeRootConfig(cfg, rootCfg), payload ?? {});

      respond(true, {
        ok: true,
        channel: CHANNEL_ID,
        resolvedAgentId,
        criteria: payload ?? {},
      });
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.discovery`, async ({ respond, cfg, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);

      try {
        const result = await callDiscovery(config, log);
        return respond(true, result);
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to discover Clawdex" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.account.provision`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<AccountProvisionParams> | undefined;

      try {
        const result = await callProvision(
          config,
          {
            email: payload?.email,
            name: payload?.name,
            password: payload?.password,
            preferredPlayerSlug: payload?.preferredPlayerSlug,
            playerName: payload?.playerName,
            channel: payload?.channel,
            accountId: payload?.accountId,
            region: payload?.region,
            clientVersion: payload?.clientVersion,
            notes: payload?.notes,
            openClawStatus: payload?.openClawStatus,
            autoReady: payload?.autoReady,
          },
          log,
        );
        return respond(true, result);
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to provision account" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.credit.balance`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<CreditBalanceParams> | undefined;

      if (!payload?.playerSlug && !payload?.email) {
        return respond(false, { error: "playerSlug or email is required" });
      }

      try {
        const result = await callCredit(config, payload, log);
        return respond(true, result);
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to resolve credit balance" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.battle.readiness`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const playerSlug = normalizeText(params?.playerSlug);

      if (!playerSlug) {
        return respond(false, { error: "playerSlug is required" });
      }

      try {
        const result = await callReadiness(config, playerSlug, log);
        return respond(true, result);
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to resolve readiness" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.battle.create`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<BattleCreateParams> | undefined;
      const resolvedAgentId = resolveAgentIdByBindings(resolveRuntimeRootConfig(cfg, rootCfg), payload ?? {});

      if (!payload?.challengerSlug || !payload?.defenderSlug) {
        return respond(false, { error: "challengerSlug and defenderSlug are required" });
      }

      const stakeValidation = validatePositiveNumber(payload?.stake, "stake");
      if (!stakeValidation.ok) {
        return respond(false, { error: stakeValidation.error });
      }

      if (payload.mode && !isValidMode(payload.mode)) {
        return respond(false, { error: `Invalid mode. Allowed: ${ALLOWED_MODES.join(", ")}` });
      }

      if (payload.visibility && !isValidVisibility(payload.visibility)) {
        return respond(false, { error: `Invalid visibility. Allowed: ${ALLOWED_VISIBILITIES.join(", ")}` });
      }

      try {
        const result = await callBattleCreate(config, { ...payload, stake: stakeValidation.value }, log);
        return respond(true, { ...result, resolvedAgentId });
      } catch (error) {
        log?.error?.(`[ClawdexPlugin] battle.create failed:`, error);
        return respond(false, { error: error instanceof Error ? error.message : "Failed to create battle" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.battle.autoplay`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<BattleAutoplayParams> | undefined;
      const resolvedAgentId = resolveAgentIdByBindings(resolveRuntimeRootConfig(cfg, rootCfg), payload ?? {});

      let challengerSlug = normalizeText(payload?.challengerSlug);
      let provisionResult: Record<string, unknown> | null = null;

      try {
        if (!challengerSlug && payload?.autoProvisionChallenger) {
          provisionResult = await callProvision(
            config,
            {
              email: payload.challengerEmail,
              name: payload.challengerName,
              preferredPlayerSlug: payload.challengerSlug,
              playerName: payload.challengerName,
              channel: payload.challengerChannel,
              accountId: payload.challengerAccountId,
              region: payload.challengerRegion,
              clientVersion: payload.challengerClientVersion,
              autoReady: payload.autoReady,
            },
            log,
          );

          const provisionedPlayer = provisionResult.player as Record<string, unknown> | undefined;
          challengerSlug = normalizeText(provisionedPlayer?.slug);
        }

        if (!challengerSlug || !payload?.defenderSlug) {
          return respond(false, {
            error: "challengerSlug and defenderSlug are required. You can set autoProvisionChallenger=true to create the challenger automatically.",
          });
        }

        const stakeValidation = validatePositiveNumber(payload.stake, "stake");
        if (!stakeValidation.ok) {
          return respond(false, { error: stakeValidation.error });
        }

        if (payload.mode && !isValidMode(payload.mode)) {
          return respond(false, { error: `Invalid mode. Allowed: ${ALLOWED_MODES.join(", ")}` });
        }

        const [challengerReadiness, defenderReadiness] = await Promise.all([
          callReadiness(config, challengerSlug, log),
          callReadiness(config, payload.defenderSlug, log),
        ]);

        if (!challengerReadiness.ready || !defenderReadiness.ready) {
          return respond(false, {
            error: "Players are not ready for auto PK yet. Ensure autoReady=true was set during provisioning.",
            challengerSlug,
            challengerReadiness,
            defenderReadiness,
            provisionResult,
          });
        }

        const result = await callBattleCreate(
          config,
          {
            challengerSlug,
            defenderSlug: payload.defenderSlug,
            mode: payload.mode,
            stake: stakeValidation.value,
            scheduledFor: payload.scheduledFor ?? DEFAULT_SCHEDULE,
            visibility: payload.visibility ?? "public",
            rulesNote: payload.rulesNote ?? "由 OpenClaw 自动发起 PK。",
          },
          log,
        );

        return respond(true, {
          ...result,
          resolvedAgentId,
          challengerSlug,
          challengerReadiness,
          defenderReadiness,
          provisionResult,
        });
      } catch (error) {
        log?.error?.(`[ClawdexPlugin] battle.autoplay failed:`, error);
        return respond(false, { error: error instanceof Error ? error.message : "Failed to autoplay battle" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.battle.accept`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<BattleAcceptParams> | undefined;
      const challengeId = normalizeText(payload?.challengeId);
      const resolvedAgentId = resolveAgentIdByBindings(resolveRuntimeRootConfig(cfg, rootCfg), payload ?? {});

      if (!challengeId) {
        return respond(false, { error: "challengeId is required" });
      }

      try {
        const result = await callBattleAccept(config, payload ?? {}, log);
        return respond(true, { ...result, resolvedAgentId });
      } catch (error) {
        log?.error?.(`[ClawdexPlugin] battle.accept failed:`, error);
        return respond(false, { error: error instanceof Error ? error.message : "Failed to accept battle" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.battle.settle`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<BattleSettleParams> | undefined;
      const challengeId = normalizeText(payload?.challengeId);
      const resolvedAgentId = resolveAgentIdByBindings(resolveRuntimeRootConfig(cfg, rootCfg), payload ?? {});

      if (!challengeId) {
        return respond(false, { error: "challengeId is required" });
      }

      if (!payload?.winnerSlug) {
        return respond(false, { error: "winnerSlug is required" });
      }

      try {
        const result = await callBattleSettle(config, payload ?? {}, log);
        return respond(true, { ...result, resolvedAgentId });
      } catch (error) {
        log?.error?.(`[ClawdexPlugin] battle.settle failed:`, error);
        return respond(false, { error: error instanceof Error ? error.message : "Failed to sync settlement" });
      }
    });

    // ─── Debate PK Gateway Methods ────────────────────────────

    /**
     * debate.topics.sync — 从 Polymarket 同步议题
     * params: { limit?: number }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.topics.sync`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as { limit?: number } | undefined;

      try {
        const result = await callDebateTopicsSync(config, payload?.limit ?? 10, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to sync topics" });
      }
    });

    /**
     * debate.topics.list — 获取已有议题列表
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.topics.list`, async ({ respond, cfg, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);

      try {
        const result = await callDebateTopicsList(config, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to list topics" });
      }
    });

    /**
     * debate.create — 创建辩论（需要先有 Challenge 和 Topic）
     * params: { challengeId, topicId, sideAPlayerSlug, sideBPlayerSlug, totalRounds? }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.create`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as {
        challengeId?: string;
        topicId?: string;
        sideAPlayerSlug?: string;
        sideBPlayerSlug?: string;
        totalRounds?: number;
      } | undefined;

      if (!payload?.challengeId || !payload?.topicId || !payload?.sideAPlayerSlug || !payload?.sideBPlayerSlug) {
        return respond(false, { error: "challengeId, topicId, sideAPlayerSlug, sideBPlayerSlug are required" });
      }

      try {
        const resolvedAgentId = await resolveAgentIdByBindings(resolveRuntimeRootConfig(cfg, rootCfg), { agentId: payload.sideAPlayerSlug } as any);
        const result = await callDebateCreate(config, payload as any, log);
        return respond(true, { ...result, resolvedAgentId, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to create debate" });
      }
    });

    /**
     * debate.start — 启动辩论（议题确定后，双方就位，启动辩论）
     * params: { debateId }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.start`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as { debateId?: string } | undefined;

      if (!payload?.debateId) {
        return respond(false, { error: "debateId is required" });
      }

      try {
        const result = await callDebateAction(config, payload.debateId, "start", undefined, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to start debate" });
      }
    });

    /**
     * debate.argue — 提交辩论发言
     * params: { debateId, playerSlug, argument }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.argue`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as { debateId?: string; playerSlug?: string; argument?: string } | undefined;

      if (!payload?.debateId || !payload?.playerSlug || !payload?.argument) {
        return respond(false, { error: "debateId, playerSlug, argument are required" });
      }

      try {
        const result = await callDebateArgue(config, payload.debateId, payload.playerSlug, payload.argument, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to submit argument" });
      }
    });

    /**
     * debate.end — 结束辩论，进入评审
     * params: { debateId, summary? }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.end`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as { debateId?: string; summary?: string } | undefined;

      if (!payload?.debateId) {
        return respond(false, { error: "debateId is required" });
      }

      try {
        const result = await callDebateAction(config, payload.debateId, "end", payload.summary, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to end debate" });
      }
    });

    /**
     * debate.get — 获取辩论详情
     * params: { debateId }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.get`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as { debateId?: string } | undefined;

      if (!payload?.debateId) {
        return respond(false, { error: "debateId is required" });
      }

      try {
        const result = await callDebateGet(config, payload.debateId, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to get debate" });
      }
    });

    /**
     * debate.list — 获取所有辩论
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.list`, async ({ respond, cfg, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);

      try {
        const result = await callDebateList(config, log);
        return respond(true, { ...result, channel: CHANNEL_ID });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Failed to list debates" });
      }
    });

    /**
     * debate.autoplay — 完整辩论自动流程
     * 1. 同步 Polymarket 议题
     * 2. 选择/创建议题
     * 3. 创建 Challenge + Debate
     * 4. 启动辩论
     * 5. A/B 交替发言
     * 6. 结束并进入评审
     *
     * params: {
     *   challengerSlug, defenderSlug, stake,
     *   topicId?, topicIndex?,
     *   arguments: { a: string[], b: string[] },
     *   totalRounds?, summary?
     * }
     */
    api.registerGatewayMethod?.(`${CHANNEL_ID}.debate.autoplay`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as {
        challengerSlug?: string;
        defenderSlug?: string;
        stake?: number;
        topicId?: string;
        topicIndex?: number;
        arguments?: { a?: string[]; b?: string[] };
        totalRounds?: number;
        summary?: string;
        scheduledFor?: string;
        mode?: BattleMode;
      } | undefined;

      if (!payload?.challengerSlug || !payload?.defenderSlug) {
        return respond(false, { error: "challengerSlug and defenderSlug are required" });
      }
      if (!payload?.arguments?.a?.length || !payload?.arguments?.b?.length) {
        return respond(false, { error: "arguments.a and arguments.b arrays are required" });
      }

      const totalRounds = payload.totalRounds ?? Math.max(payload.arguments.a.length, payload.arguments.b.length);

      try {
        // Step 1: 获取或同步议题
        let topicId = payload.topicId;
        if (!topicId) {
          log?.info?.("[DebateAutoplay] Syncing Polymarket topics...");
          const syncResult = await callDebateTopicsSync(config, 10, log);
          const topics = syncResult.topics as Array<{ id: string }>;
          const idx = payload.topicIndex ?? 0;
          if (!topics || topics.length === 0) {
            return respond(false, { error: "No topics available from Polymarket" });
          }
          topicId = topics[Math.min(idx, topics.length - 1)]?.id;
          if (!topicId) {
            return respond(false, { error: "Failed to get topic ID" });
          }
        }

        // Step 2: 创建 Challenge
        log?.info?.("[DebateAutoplay] Creating challenge...");
        const battleResult = await callBattleCreate(config, {
          challengerSlug: payload.challengerSlug,
          defenderSlug: payload.defenderSlug,
          stake: payload.stake ?? 30,
          scheduledFor: payload.scheduledFor ?? "辩论赛",
          mode: payload.mode ?? "public-arena",
          rulesNote: `Polymarket 议题辩论 PK，共 ${totalRounds} 轮`,
        }, log);

        const challengeId = (battleResult.challenge as any)?.id;
        if (!challengeId) {
          return respond(false, { error: "Failed to create challenge", battleResult });
        }

        // Step 3: 接受 Challenge
        log?.info?.("[DebateAutoplay] Accepting challenge...");
        await callBattleAccept(config, {
          challengeId,
          defenderSlug: payload.defenderSlug,
        }, log);

        // Step 4: 创建 Debate
        log?.info?.("[DebateAutoplay] Creating debate...");
        const debateResult = await callDebateCreate(config, {
          challengeId,
          topicId,
          sideAPlayerSlug: payload.challengerSlug,
          sideBPlayerSlug: payload.defenderSlug,
          totalRounds,
        }, log);

        const debateId = (debateResult.debate as any)?.id;
        if (!debateId) {
          return respond(false, { error: "Failed to create debate", debateResult });
        }

        // Step 5: 启动辩论
        log?.info?.("[DebateAutoplay] Starting debate...");
        await callDebateAction(config, debateId, "start", undefined, log);

        // Step 6: 交替发言
        const roundResults = [];
        for (let round = 0; round < totalRounds; round++) {
          // A 先
          if (payload.arguments.a[round]) {
            log?.info?.(`[DebateAutoplay] Round ${round + 1}: Side A arguing...`);
            const aResult = await callDebateArgue(config, debateId, payload.challengerSlug, payload.arguments.a[round], log);
            roundResults.push({ round: round + 1, side: "A", ok: true });
          }
          // B 后
          if (payload.arguments.b[round]) {
            log?.info?.(`[DebateAutoplay] Round ${round + 1}: Side B arguing...`);
            const bResult = await callDebateArgue(config, debateId, payload.defenderSlug, payload.arguments.b[round], log);
            roundResults.push({ round: round + 1, side: "B", ok: true });
          }
        }

        // Step 7: 结束辩论
        log?.info?.("[DebateAutoplay] Ending debate...");
        const endResult = await callDebateAction(config, debateId, "end", payload.summary, log);

        return respond(true, {
          ok: true,
          channel: CHANNEL_ID,
          challengeId,
          debateId,
          topicId,
          totalRounds,
          roundResults,
          debate: endResult.debate,
          message: `辩论自动流程完成！共 ${totalRounds} 轮，已进入评审阶段。`,
        });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Debate autoplay failed" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.selftest.quick`, async ({ respond, cfg, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);

      try {
        const [status, discovery] = await Promise.all([
          callStatus(config, log),
          callDiscovery(config, log),
        ]);

        return respond(true, {
          ok: true,
          channel: CHANNEL_ID,
          status,
          discovery,
          message: "Quick self-test passed. Control plane is reachable and discovery is working.",
        });
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Quick self-test failed" });
      }
    });

    api.registerGatewayMethod?.(`${CHANNEL_ID}.selftest.full`, async ({ respond, cfg, params, log }) => {
      const config = getEffectiveConfig(cfg, rootCfg);
      const payload = params as Partial<FullSelfTestParams> | undefined;

      try {
        const result = await runFullSelfTest(config, payload ?? {}, log);
        return respond(true, result);
      } catch (error) {
        return respond(false, { error: error instanceof Error ? error.message : "Full self-test failed" });
      }
    });

    api.logger?.info?.("[Clawdex] Clawdex channel plugin registered with live control-plane adapter methods");
  },
};

export default plugin;
export {
  callControlPlane,
  channelPlugin,
  getConfig,
  isConfigured,
  isValidMode,
  matchesField,
  normalizeText,
  resolveAgentIdByBindings,
  resolveRuntimeRootConfig,
  validatePositiveNumber,
};
