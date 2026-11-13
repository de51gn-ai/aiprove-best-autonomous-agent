// AIProve REST client. Endpoints are derived from skill.md where possible
// (see parseEndpoints) and fall back to the documented defaults.
const TIMEOUT_MS = 30000;

async function http(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response from ${url} (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  return json;
}

/** Pull the endpoint table out of skill.md so the agent drives the documented API. */
export function parseEndpoints(skillMd) {
  const endpoints = {};
  for (const line of skillMd.split("\n")) {
    const m = line.match(/^\|\s*(GET|POST)\s*\|\s*`([^`]+)`\s*\|/);
    if (m) endpoints[`${m[1]} ${m[2]}`] = true;
  }
  return endpoints;
}

export class Aiprove {
  constructor(baseUrl) {
    this.base = baseUrl.replace(/\/$/, "");
    this.token = null;
  }

  async fetchSkill() {
    const res = await fetch(`${this.base}/skill.md`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`skill.md fetch failed: HTTP ${res.status}`);
    return res.text();
  }

  async challenge(address) {
    const r = await http(`${this.base}/api/auth/challenge?address=${address}`);
    if (!r.challenge) throw new Error(`no challenge in response: ${JSON.stringify(r).slice(0, 200)}`);
    return r.challenge;
  }

  async verify(address, signature) {
    const r = await http(`${this.base}/api/auth/verify`, {
      method: "POST",
      body: { address, signature },
    });
    if (!r.token) throw new Error(`no token in verify response: ${JSON.stringify(r).slice(0, 200)}`);
    this.token = r.token;
    return r;
  }

  authHeaders() {
    if (!this.token) throw new Error("not authenticated");
    return { Authorization: `Bearer ${this.token}` };
  }

  async listBounties(status = "open") {
    const r = await http(`${this.base}/api/bounties?status=${status}`);
    return Array.isArray(r) ? r : r.bounties || [];
  }

  async getBounty(slug) {
    return http(`${this.base}/api/bounties/${slug}`);
  }

  async enter(slug, handle) {
    return http(`${this.base}/api/bounties/${slug}/enter`, {
      method: "POST",
      headers: this.authHeaders(),
      body: { handle },
    });
  }

  async submit(slug, payload) {
    return http(`${this.base}/api/bounties/${slug}/submit`, {
      method: "POST",
      headers: this.authHeaders(),
      body: payload,
    });
  }

  async mySubmissions() {
    const r = await http(`${this.base}/api/me/submissions`, { headers: this.authHeaders() });
    return r.submissions || [];
  }
}
