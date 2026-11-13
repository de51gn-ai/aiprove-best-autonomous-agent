// Deterministic code-task solvers. Each solver fetches the public cases from
// the official challenges repo, builds a solution, and verifies it against
// every public case before the orchestrator publishes it. Nothing is
// submitted unverified.
import { spawn } from "node:child_process";

const RAW = "https://raw.githubusercontent.com/AIProveRH/aiprove/main/challenges";

// One retry after a short pause: public-asset fetches occasionally stall and
// a single timeout should not kill an otherwise healthy run.
async function fetchJson(url, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw lastError;
}

const approx = (a, b) => Math.abs(a - b) < 1e-9;

function runNode(file, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [file], { timeout: 30000 });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`node exited ${code}: ${err.slice(0, 200)}`))
    );
    child.stdin.end(stdin);
  });
}

/** code-golf-expr: the expression language is a subset of JS expressions,
 *  so `eval` is a correct evaluator — 30 bytes total. */
export async function solveCodeGolf() {
  const cases = await fetchJson(`${RAW}/code-golf-expr/cases.json`);
  const source = "module.exports={evalExpr:eval}";
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  const { evalExpr } = module.exports;
  for (const c of cases) {
    const got = evalExpr(c.in);
    if (!approx(got, c.out)) throw new Error(`code-golf case failed: ${c.in} -> ${got}, want ${c.out}`);
  }
  return {
    files: {
      "index.js": source, // exactly 30 bytes — no trailing newline; the metric is bytes
      "README.md":
        "# code-golf-expr\n\n`evalExpr` via `eval`: the expression language (+ - * / decimals parens precedence) is a subset of JS expressions, so `eval` is a correct evaluator.\n\n- Entry: `index.js` (30 bytes)\n- Verified against every public case in `cases.json` before submission.\n",
    },
    note: `code-golf-expr: ${source.length}-byte eval solution, ${cases.length}/${cases.length} public cases pass`,
  };
}

const SIEVE = `// Odd-only Sieve of Eratosthenes over a Uint8Array. Index i represents 2i+3.
const fs = require("fs");
const N = parseInt(fs.readFileSync(0, "utf8").trim(), 10);
if (N < 2) { console.log(0); process.exit(0); }
const size = ((N - 1) >> 1);
const sieve = new Uint8Array(size);
const limit = Math.floor(Math.sqrt(N));
for (let i = 0; i < size; i++) {
  if (sieve[i]) continue;
  const p = 2 * i + 3;
  if (p > limit) break;
  for (let j = (p * p - 3) >> 1; j < size; j += p) sieve[j] = 1;
}
let count = 1; // prime 2
for (let i = 0; i < size; i++) if (!sieve[i]) count++;
console.log(count);
`;

/** fastest-primes: odd-only sieve. Verified by running it on the public cases. */
export async function solveFastestPrimes() {
  const cases = await fetchJson(`${RAW}/fastest-primes/cases.json`);
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "aiprove-primes-"));
  try {
    const file = join(dir, "primes.js");
    writeFileSync(file, SIEVE);
    for (const c of cases) {
      const stdout = await runNode(file, String(c.n));
      const got = parseInt(stdout.trim(), 10);
      if (got !== c.count) throw new Error(`fastest-primes case failed: N=${c.n} -> ${got}, want ${c.count}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    files: {
      "primes.js": SIEVE,
      "README.md":
        "# fastest-primes\n\nOdd-only Sieve of Eratosthenes over a `Uint8Array` (index i = 2i+3).\n\n- Run: `node primes.js` (reads N on stdin, prints the count of primes <= N)\n- Verified against every public case in `cases.json` before submission.\n",
    },
    note: `fastest-primes: odd-only sieve, ${cases.length}/${cases.length} public cases pass`,
  };
}
