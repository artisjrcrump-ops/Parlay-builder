// Cloudflare Worker: a tiny pass-through to the PropLine odds API for the Parlay Builder.
// It keeps the PropLine key secret (stored as the Worker secret PROPLINE_KEY), lets the app
// call it from the browser (CORS), and caches answers for 60 seconds so repeat taps are free.
// Setup: worker/SETUP.md.

const ALLOWED_ORIGINS = ["https://artisjrcrump-ops.github.io"];
const UPSTREAM = "https://api.prop-line.com";
const CACHE_SECONDS = 60;

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Daily-Remaining, X-Daily-Limit",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (request.method !== "GET") return new Response("Only GET", { status: 405, headers: cors(origin) });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("Not allowed", { status: 403 });

    const url = new URL(request.url);
    // Only odds reads: /v1/sports/... and /v1/bet-links/...
    if (!/^\/v1\/(sports|bet-links)(\/|$)/.test(url.pathname)) {
      return new Response("Not found", { status: 404, headers: cors(origin) });
    }
    url.searchParams.delete("apiKey"); // never accept a key from the page
    const target = `${UPSTREAM}${url.pathname}${url.search}`;

    const cache = caches.default;
    const cacheKey = new Request(target);
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(target, { headers: { "X-API-Key": env.PROPLINE_KEY, Accept: "application/json" } });
      res = new Response(up.body, up);
      if (up.ok) {
        res.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors(origin))) out.headers.set(k, v);
    return out;
  },
};
