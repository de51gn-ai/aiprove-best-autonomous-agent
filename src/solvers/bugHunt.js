// bug-hunt-utils solver: fetch the official utils.js, probe every function
// against an independent reference implementation, and report only genuine
// mismatches (first failing input per function). No hardcoded bug list — the
// detector finds whatever is actually broken.
const UTILS_URL =
  "https://raw.githubusercontent.com/AIProveRH/aiprove/main/challenges/bug-hunt-utils/utils.js";

// Independent reference implementations (written from the function names,
// not copied from utils.js).
const REFERENCE = {
  sum: (a) => a.reduce((x, y) => x + y, 0),
  max: (a) => Math.max(...a),
  reverse: (s) => [...s].reverse().join(""),
  isPalindrome: (s) => s === [...s].reverse().join(""),
  factorial: (n) => (n <= 1 ? 1 : n * REFERENCE.factorial(n - 1)),
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  unique: (a) => [...new Set(a)],
  average: (a) => a.reduce((x, y) => x + y, 0) / a.length,
  // Note: \b treats an apostrophe as a word boundary, so a naive /\b\w/
  // reference would reproduce the very bug being hunted. The reference
  // capitalizes only letters that start a whitespace-delimited word.
  titleCase: (s) => s.replace(/(^|\s)([a-z])/g, (_, sp, c) => sp + c.toUpperCase()),
  countVowels: (s) => (s.match(/[aeiouAEIOU]/g) || []).length,
};

// Probes: [fn, ...args]. Each fn gets at least one ordinary input and one
// edge-case input that distinguishes the common bug classes (off-by-one,
// case-sensitivity, word boundaries, astral-plane characters).
const PROBES = [
  ["sum", [1, 2, 3]],
  ["sum", []],
  ["max", [1, 5, 3]],
  ["max", [-2, -9]],
  ["reverse", "abc"],
  ["reverse", "😀a"],
  ["isPalindrome", "racecar"],
  ["isPalindrome", "hello"],
  ["factorial", 0],
  ["factorial", 1],
  ["factorial", 5],
  ["clamp", 5, 0, 10],
  ["clamp", -1, 0, 10],
  ["clamp", 99, 0, 10],
  ["unique", [1, 1, 2, 3, 3]],
  ["average", [2, 4]],
  ["average", [1, 2, 3, 4]],
  ["titleCase", "hello world"],
  ["titleCase", "don't stop"],
  ["countVowels", "hello"],
  ["countVowels", "AEIOU"],
];

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function solveBugHunt() {
  let src;
  let lastError;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(UTILS_URL, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`utils.js fetch failed: HTTP ${res.status}`);
      src = await res.text();
      break;
    } catch (e) {
      lastError = e;
      if (i === 0) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (src === undefined) throw lastError;
  // Load the challenge file in a minimal CommonJS shim. The source comes
  // from the official AIProve challenges repo (public, read-only).
  const module = { exports: {} };
  new Function("module", "exports", src)(module, module.exports);
  const utils = module.exports;

  const reports = [];
  const seen = new Set();
  for (const [fn, ...args] of PROBES) {
    if (seen.has(fn)) continue;
    if (typeof utils[fn] !== "function" || typeof REFERENCE[fn] !== "function") continue;
    let got;
    let threw = false;
    try {
      got = utils[fn](...args);
    } catch {
      threw = true;
    }
    const expected = REFERENCE[fn](...args);
    if (threw || !deepEqual(got, expected)) {
      reports.push({ fn, input: args.length === 1 ? args[0] : args, expected });
      seen.add(fn);
    }
  }
  return reports;
}
