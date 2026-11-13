# Build log — aiprove-autonomous-agent

## Build (2026-11-14, agent session)

- Read `skill.md` (API base, EIP-191 challenge auth, enter/submit shapes) and
  the challenges repo (`code-golf-expr`, `fastest-primes`, `bug-hunt-utils`,
  `eth-backtest` specs + public cases).
- Verified the free data feeds the baseline strategy needs before writing
  code: CoinGecko simple price (BTC/ETH + 24h change, no key), Yahoo Finance
  chart API (SPY/NVDA/GLD, no key; Stooq returned empty and was dropped),
  GeckoTerminal `new_pools` on Robinhood Chain (WETH-paired pons launches).
- Wrote the agent (Node.js, ethers v6, zero other dependencies):
  `src/index.js` orchestrator, `src/api.js` REST client + skill.md endpoint
  parser, `src/strategy.js` classifier + baseline forecast strategy,
  `src/market.js` keyless feeds, `src/solvers/bugHunt.js` probe-based bug
  detection, `src/solvers/codeTasks.js` verified code solvers,
  `src/publish.js` GitHub publishing (`gh` CLI or `GITHUB_TOKEN`).
- Smoke-tested every solver in isolation before the live run: bug hunt found
  exactly the 4 real bugs (reverse/factorial/titleCase/countVowels);
  code-golf 9/9 public cases, 30 bytes; fastest-primes 5/5 public cases;
  top-5 feed returned 5 distinct WETH-paired pons tickers.

## Test run 1 — live API, 2026-11-14 ~00:01 WIB

- Identity: ephemeral keypair `0xd15932A30B0b8fa3EfD3A7B1D0493db82b7A1D0b`
  (generated at runtime; key never printed or stored).
- Entered: **21/21** open bounties.
- Completed: **10**, all `provenance_ok`, all verified via
  `GET /api/me/submissions` (10/10):
  - `btc-tomorrow` (no @ 0.55) — 3b9a321f
  - `forecast-btc-7d` (no @ 0.55) — eaaf7a50
  - `spy-close-1dollar` ($749.73, Yahoo SPY) — 3fe78a6d
  - `top5-pons-24h` (EGL, GANGSTAZ, CHUD, EGGLO, 1) — a898f68b
  - `forecast-eth-24h` (no @ 0.55) — 6ca1c0cd
  - `forecast-nvda-3d` ($159.86, Yahoo NVDA) — cdae0a84
  - `signal-eth-pnl-24h` (short; ETH 24h −3.99%) — 57e03981
  - `forecast-gold-tomorrow` ($355.33, Yahoo GLD) — 8e1b2bc6
  - `code-golf-expr` (30-byte eval, 9/9 cases; repo
    `de51gn-ai/aiprove-agent-code-golf-expr`) — 416c4703
  - `bug-hunt-utils` (4 reports; repo publish hit the GitHub rate limit, so
    it fell back to prediction-only and was still accepted) — b6045db3
- Skipped: **10** with documented reasons (creative work needs external
  generation keys; post-on-x needs a human X account; refer-most-agents
  needs other agents; eth-pnl-fixed needs a strategy + backtest;
  sample-agent-skillmd and best-autonomous-agent are meta bounties).
- Failed: **1** — `fastest-primes`: the solver verified 5/5 cases, but the
  repo publish hit GitHub's new-account throttle ("You have created too
  many repositories, too quickly") after the code-golf repo was created.
  Retried in run 2 (below) after the throttle lifted.

## Test run 2 — targeted retry, fastest-primes only, 2026-11-14 ~00:45 WIB

- Failed on a transient network timeout fetching the public `cases.json`
  (20s fetch abort). No submission made; the run's ephemeral identity
  (`0xB019f2A3d9F2a58705c91c6B2920449fd25A9C38`) only entered the bounty.
- Fix applied: solver fetches now retry once after 5s with a 45s timeout
  (`codeTasks.js`, `bugHunt.js`).

## Test run 3 — targeted retry, fastest-primes only, 2026-11-14 ~00:50 WIB

- Identity: ephemeral keypair `0x6f01a54F36C85b48D8cCcedA7d5664e13B666093`.
- `fastest-primes`: solver verified 5/5 cases, repo published
  (`de51gn-ai/aiprove-agent-fastest-primes`, GitHub throttle had lifted),
  submission `3a60acf3` — `provenance_ok`, verified 1/1.

## Totals across test runs

- Distinct bounties completed by the agent: **11 of 21** (8 forecasts +
  code-golf-expr + fastest-primes + bug-hunt-utils). All 11 submissions
  `provenance_ok` and verified via `/api/me/submissions` inside the runs.
- The remaining 10 were entered and skipped with documented reasons (see
  README); none were attempted and faked.
