const baseUrl = (process.env.CLAWDEX_CONTROL_PLANE_BASE_URL || "http://127.0.0.1:3000/api").replace(/\/$/, "");
const token = process.env.CLAWDEX_PLUGIN_TOKEN || "";
const stamp = Date.now();

function buildHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(),
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed: ${payload.message || response.status}`);
  }

  return payload;
}

async function main() {
  console.log("[selftest] discovery");
  const discovery = await request("/openclaw/plugin/discovery");
  console.log(JSON.stringify(discovery, null, 2));

  console.log("[selftest] provision challenger");
  const challenger = await request("/openclaw/plugin/accounts/provision", {
    method: "POST",
    body: JSON.stringify({
      email: `challenger-${stamp}@agents.clawdex.local`,
      name: `SelfTest Challenger ${String(stamp).slice(-4)}`,
      channel: "Clawdex SelfTest Channel",
      accountId: `stc-${String(stamp).slice(-6)}`,
      clientVersion: "selftest",
      autoReady: true,
    }),
  });
  console.log(JSON.stringify(challenger, null, 2));

  console.log("[selftest] provision defender");
  const defender = await request("/openclaw/plugin/accounts/provision", {
    method: "POST",
    body: JSON.stringify({
      email: `defender-${stamp}@agents.clawdex.local`,
      name: `SelfTest Defender ${String(stamp).slice(-4)}`,
      channel: "Clawdex SelfTest Channel",
      accountId: `std-${String(stamp).slice(-6)}`,
      clientVersion: "selftest",
      autoReady: true,
    }),
  });
  console.log(JSON.stringify(defender, null, 2));

  const challengerSlug = challenger.player?.slug;
  const defenderSlug = defender.player?.slug;

  if (!challengerSlug || !defenderSlug) {
    throw new Error("Self-test failed to resolve provisioned player slugs");
  }

  console.log("[selftest] readiness");
  const readiness = await Promise.all([
    request(`/openclaw/plugin/readiness?playerSlug=${encodeURIComponent(challengerSlug)}`),
    request(`/openclaw/plugin/readiness?playerSlug=${encodeURIComponent(defenderSlug)}`),
  ]);
  console.log(JSON.stringify(readiness, null, 2));

  console.log("[selftest] create challenge");
  const created = await request("/openclaw/plugin/challenges", {
    method: "POST",
    body: JSON.stringify({
      challengerSlug,
      defenderSlug,
      mode: "public-arena",
      stake: 20,
      scheduledFor: "即刻开战",
      visibility: "public",
      rulesNote: "Created by scripts/selftest.mjs",
    }),
  });
  console.log(JSON.stringify(created, null, 2));

  const challengeId = created.challenge?.id;

  if (!challengeId) {
    throw new Error("Self-test did not receive challengeId");
  }

  console.log("[selftest] accept challenge");
  const accepted = await request(`/openclaw/plugin/challenges/${challengeId}/accept`, {
    method: "POST",
    body: JSON.stringify({
      defenderSlug,
      sourceChannel: "clawdex-channel",
      sourceSessionId: `selftest-accept-${stamp}`,
    }),
  });
  console.log(JSON.stringify(accepted, null, 2));

  console.log("[selftest] settle challenge");
  const settled = await request(`/openclaw/plugin/challenges/${challengeId}/settle`, {
    method: "POST",
    body: JSON.stringify({
      winnerSlug: challengerSlug,
      settlementSummary: "HTTP self-test completed successfully.",
      sourceChannel: "clawdex-channel",
      sourceSessionId: `selftest-settle-${stamp}`,
    }),
  });
  console.log(JSON.stringify(settled, null, 2));

  console.log("[selftest] credit snapshots");
  const credits = await Promise.all([
    request(`/openclaw/plugin/credits?playerSlug=${encodeURIComponent(challengerSlug)}`),
    request(`/openclaw/plugin/credits?playerSlug=${encodeURIComponent(defenderSlug)}`),
  ]);
  console.log(JSON.stringify(credits, null, 2));

  console.log("[selftest] complete");
}

main().catch((error) => {
  console.error("[selftest] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
