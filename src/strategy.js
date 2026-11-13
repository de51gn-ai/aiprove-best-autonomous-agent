// Forecast strategy (baseline v1) — deliberately simple, fully documented,
// and swappable: replace `predict` with a better model without touching the
// orchestrator. The baseline is honest about what it is:
//
// - yes/no direction (Brier score): answer "no" at 0.55 confidence. A flat
//   prior, not an edge — direction questions on this board ask whether an
//   asset will be HIGHER by a deadline, and a 0.55 "no" is a calibrated-ish
//   base rate, not a prediction.
// - numeric value (Absolute error): the current market price ("price
//   persists" naive forecast). The number comes from a live free feed, never
//   invented; if the feed fails, the bounty is skipped.
// - long/short signal (Realized PnL): 24h momentum — negative 24h change
//   means short, otherwise long.
// - top-5 launches (Overlap): the 5 highest-FDV qualifying launches of the
//   last 24h from GeckoTerminal (see market.js).
import { cryptoPrices, stockPrice, topPonsLaunches } from "./market.js";

const STOCK_SYMBOLS = { spy: "SPY", nvda: "NVDA", gold: "GLD", gld: "GLD" };
const CRYPTO_SYMBOLS = { btc: "BTC", eth: "ETH" };

function symbolFor(slug, brief = "") {
  const hay = `${slug} ${brief}`.toLowerCase();
  for (const [kw, sym] of Object.entries(STOCK_SYMBOLS)) if (hay.includes(kw)) return { sym, kind: "stock" };
  for (const [kw, sym] of Object.entries(CRYPTO_SYMBOLS)) if (hay.includes(kw)) return { sym, kind: "crypto" };
  return null;
}

/** Decide what kind of work a bounty needs. Returns null when not completable. */
export function classify(bounty) {
  const slug = bounty.slug;
  const metric = (bounty.metric || "").toLowerCase();
  if (slug === "bug-hunt-utils") return { kind: "bughunt" };
  if (slug === "code-golf-expr") return { kind: "code", solver: "codeGolf" };
  if (slug === "fastest-primes") return { kind: "code", solver: "fastestPrimes" };
  if (metric.includes("brier")) return { kind: "forecast-yesno" };
  if (metric.includes("absolute error")) return { kind: "forecast-numeric" };
  if (metric.includes("realized pnl")) return { kind: "signal" };
  if (metric.includes("overlap with realized top 5")) return { kind: "top5" };
  return null;
}

/** Why a bounty is skipped. Kept honest: the agent never pretends to do these. */
export function skipReason(bounty) {
  const slug = bounty.slug;
  const cat = bounty.cat;
  if (slug === "best-autonomous-agent") return "self-bounty: an agent cannot submit itself as its own entry";
  if (slug === "sample-agent-skillmd") return "needs a separate sample-agent repo; this agent is the entry, not the sample";
  if (slug === "eth-pnl-fixed") return "needs a trading strategy + backtest; not implemented in the baseline";
  if (slug === "post-on-x-aiprove") return "needs a human X account";
  if (slug === "refer-most-agents") return "needs other agents to refer; cannot self-refer";
  if (cat === "content" || cat === "design" || cat === "marketing") {
    return "needs original creative work (article/image/video) or a social account; no generation capability without external API keys";
  }
  return "no solver for this bounty type in the baseline";
}

/**
 * Build the prediction payload for a forecast bounty.
 * Returns { prediction, note } or { skip: reason }.
 */
export async function predict(bounty, task) {
  const { kind } = task;
  if (kind === "forecast-yesno") {
    return {
      prediction: { answer: "no", confidence: 0.55 },
      note: "baseline v1: flat 'no' @ 0.55 prior for direction questions",
    };
  }
  if (kind === "forecast-numeric") {
    const s = symbolFor(bounty.slug, bounty.brief);
    if (!s) return { skip: "numeric forecast but no mappable symbol in slug/brief" };
    let price = null;
    let source = "";
    if (s.kind === "stock") {
      price = await stockPrice(s.sym);
      source = `Yahoo Finance ${s.sym}`;
    } else {
      const c = await cryptoPrices();
      price = c?.[s.sym]?.price ?? null;
      source = `CoinGecko ${s.sym}/USD`;
    }
    if (price === null || !Number.isFinite(price)) return { skip: `price feed unreachable for ${s.sym}` };
    const value = s.sym === "BTC" ? Math.round(price) : Math.round(price * 100) / 100;
    return {
      prediction: { value },
      note: `baseline v1: naive "price persists" forecast, ${source} last price $${value}`,
    };
  }
  if (kind === "signal") {
    const c = await cryptoPrices();
    const chg = c?.ETH?.change24h;
    if (chg === undefined || chg === null) return { skip: "ETH 24h change unreachable" };
    const answer = chg < 0 ? "short" : "long";
    return {
      prediction: { answer },
      note: `baseline v1: 24h momentum rule, ETH 24h change ${chg.toFixed(2)}% -> ${answer}`,
    };
  }
  if (kind === "top5") {
    const top = await topPonsLaunches();
    if (!top) return { skip: "fewer than 5 qualifying pons launches in the last 24h (or feed unreachable)" };
    return {
      prediction: top,
      note: `baseline v1: top-5 WETH-paired pons launches by FDV (GeckoTerminal): ${top.tokens.join(", ")}`,
    };
  }
  return { skip: `no prediction strategy for kind ${kind}` };
}
