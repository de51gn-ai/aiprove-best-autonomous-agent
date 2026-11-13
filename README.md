# aiprove-autonomous-agent

A fully autonomous AIProve agent: it reads `skill.md`, authenticates with its
own keypair, enters every open bounty, and completes as many as it can — with
no human in the loop and no external API keys.

Built as an entry for the **best-autonomous-agent** bounty on
[aiprove.fun](https://aiprove.fun) (metric: bounties completed autonomously).

## Run

```bash
npm install
npm start
```

No configuration is required: without `AGENT_PRIVATE_KEY` the agent generates
an ephemeral keypair at runtime (only the address is printed, never the key).
Set `API_BASE_URL` to point it at a staging arena.

## What it does

| Step | How |
| --- | --- |
| Read the board | Fetches `GET /skill.md`, parses the endpoint table |
| Authenticate | EIP-191 `personal_sign` challenge with its own keypair (ethers v6) |
| Enter | `POST /api/bounties/:slug/enter` for every open bounty (free) |
| Complete | Per-bounty solvers (below); every submission goes through the real `POST .../submit` endpoint with a real transcript |
| Verify | Re-reads `GET /api/me/submissions` and counts what actually landed |

## Solvers

- **Forecast, yes/no (Brier)** — baseline v1: flat `"no"` at 0.55 confidence.
  A documented prior, not an edge.
- **Forecast, numeric (Absolute error)** — naive "price persists": the live
  price from a free feed (CoinGecko for BTC/ETH, Yahoo Finance for
  SPY/NVDA/GLD). If the feed fails, the bounty is skipped, never guessed.
- **Signal (Realized PnL)** — 24h momentum rule on ETH: negative 24h change
  means short, otherwise long.
- **Top-5 launches (Overlap)** — top-5 WETH-paired pons launches of the last
  24h by FDV from GeckoTerminal's public API (USDG/stable pairs excluded).
- **bug-hunt-utils** — fetches the official `utils.js`, probes every function
  against an independent reference implementation, submits only genuine
  mismatches as `[{fn, input, expected}]`.
- **code-golf-expr / fastest-primes** — builds the solution, verifies it
  against every public case from the challenges repo, publishes it as a
  public GitHub repo, then submits repo @ commit.

## What it deliberately does not do

- Content/design bounties (article, meme, art, mascot, video): they need
  original creative work; the agent has no generation capability without
  external API keys, so it enters and skips them with a logged reason.
- `post-on-x`: needs a human X account. `refer-most-agents`: needs other
  agents (no self-referrals). `eth-pnl-fixed`: needs a trading strategy +
  backtest, not implemented in the baseline. `sample-agent-skillmd` and
  `best-autonomous-agent` (itself): meta bounties the agent cannot
  meaningfully self-submit.
- Code bounties when no git publishing credential exists (no authenticated
  `gh` CLI and no `GITHUB_TOKEN`): it skips rather than submitting a repo
  URL that does not exist.

## Layout

```
src/
  index.js            orchestrator: read -> auth -> enter -> complete -> verify
  api.js              AIProve REST client + skill.md endpoint parser
  strategy.js         bounty classifier + baseline forecast strategy (swappable)
  market.js           free keyless price feeds (CoinGecko, Yahoo, GeckoTerminal)
  solvers/bugHunt.js  probe-based bug detection
  solvers/codeTasks.js deterministic code-task solvers + case verification
  publish.js          GitHub repo publishing (gh CLI or GITHUB_TOKEN)
```

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `API_BASE_URL` | `https://aiprove.fun` | Arena base URL (staging override) |
| `AGENT_PRIVATE_KEY` | *(ephemeral)* | Agent keypair; never committed, never printed |
| `AGENT_HANDLE` | `de51gn.auto` | Handle attached to enters/submissions |
| `GITHUB_TOKEN` / `GITHUB_USER` | — | Enables repo publishing without `gh` |
| `AGENT_GIT_NAME` / `AGENT_GIT_EMAIL` | `aiprove-auto-agent` / `agent@aiprove.fun` | Commit identity for published solutions |

## Test run

See [TRANSCRIPT.md](./TRANSCRIPT.md) for the build log and the recorded live
test run (entered/completed counts, verified against `/api/me/submissions`).
