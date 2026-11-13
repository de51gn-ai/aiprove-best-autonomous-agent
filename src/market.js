// Free, keyless market data feeds used by the baseline forecast strategy.
// Every function returns null on failure so the caller can skip cleanly
// instead of submitting a made-up number.
const TIMEOUT_MS = 20000;
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" };

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** BTC/ETH spot + 24h change from CoinGecko (no key). */
export async function cryptoPrices() {
  try {
    const d = await getJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true"
    );
    return {
      BTC: { price: d.bitcoin.usd, change24h: d.bitcoin.usd_24h_change },
      ETH: { price: d.ethereum.usd, change24h: d.ethereum.usd_24h_change },
    };
  } catch (e) {
    console.log(`  [market] CoinGecko failed: ${e.message}`);
    return null;
  }
}

/** US stock/ETF last price from Yahoo Finance chart API (no key). */
export async function stockPrice(symbol) {
  try {
    const d = await getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      UA
    );
    const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch (e) {
    console.log(`  [market] Yahoo ${symbol} failed: ${e.message}`);
    return null;
  }
}

const NATIVE_ID = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // WETH/native quote on GeckoTerminal

/**
 * Top-5 newest WETH-paired pons-style launches on Robinhood Chain by FDV,
 * from GeckoTerminal's public new_pools endpoint (no key).
 * Returns { tokens: [symbols], addresses: [base token addresses] } or null.
 */
export async function topPonsLaunches() {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const pools = [];
    for (const page of [1, 2]) {
      const d = await getJson(
        `https://api.geckoterminal.com/api/v2/networks/robinhood/new_pools?page=${page}`,
        { Accept: "application/json" }
      );
      for (const p of d.data || []) pools.push(p);
      if (pools.length >= 20) break;
    }
    const candidates = [];
    for (const p of pools) {
      const a = p.attributes || {};
      const rel = p.relationships || {};
      const quoteId = (rel.quote_token?.data?.id || "").replace("robinhood_", "").toLowerCase();
      const baseId = (rel.base_token?.data?.id || "").replace("robinhood_", "");
      const dex = rel.dex?.data?.id || "";
      const created = Date.parse(a.pool_created_at);
      const fdv = parseFloat(a.fdv_usd);
      const name = a.name || "";
      // WETH-paired pons launch from the last 24h (USDG/stable pairs excluded:
      // quote must be native/WETH).
      if (quoteId !== NATIVE_ID) continue;
      if (!dex.startsWith("pons")) continue;
      if (!created || created < cutoff) continue;
      if (!Number.isFinite(fdv)) continue;
      const symbol = name.split(" / ")[0]?.trim();
      if (!symbol || !baseId) continue;
      candidates.push({ symbol, address: baseId, fdv });
    }
    candidates.sort((x, y) => y.fdv - x.fdv);
    // Dedupe by symbol (same ticker, different token): keep the highest-FDV
    // one so the prediction is 5 distinct tickers.
    const seen = new Set();
    const top = [];
    for (const c of candidates) {
      if (seen.has(c.symbol)) continue;
      seen.add(c.symbol);
      top.push(c);
      if (top.length === 5) break;
    }
    if (top.length < 5) {
      console.log(`  [market] only ${top.length} qualifying pons launches in 24h`);
      return null;
    }
    return { tokens: top.map((t) => t.symbol), addresses: top.map((t) => t.address) };
  } catch (e) {
    console.log(`  [market] GeckoTerminal failed: ${e.message}`);
    return null;
  }
}
