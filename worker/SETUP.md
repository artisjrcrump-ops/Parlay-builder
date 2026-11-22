# Real FanDuel prices: 3-step setup (free)

You need: your PropLine API key (emailed after signing up at https://prop-line.com/#get-started)
and a free Cloudflare account (https://dash.cloudflare.com/sign-up).

1. **Make the Worker.** In Cloudflare, open **Workers & Pages** → **Create** → **Create Worker**.
   Name it `propline` and tap **Deploy**. Then tap **Edit code**, delete everything in the editor,
   paste the whole file `worker/propline-worker.js` from the repo
   (https://github.com/artisjrcrump-ops/Parlay-builder/blob/main/worker/propline-worker.js — tap "Raw"),
   and tap **Deploy**.
2. **Add your key.** Go back to the Worker → **Settings** → **Variables and Secrets** → **Add**.
   Type: **Secret**. Name: `PROPLINE_KEY`. Value: your PropLine key. Save / Deploy.
3. **Tell the app.** Copy the Worker's address (looks like `https://propline.YOURNAME.workers.dev`).
   In the Parlay Builder open **⚙️ Settings** and paste it into **Real odds (PropLine Worker)**.

The key stays inside Cloudflare; the app and this repo never see it.
Free limits: PropLine 1,000 requests a day, Cloudflare 100,000 a day. The app loads one sport's
whole slate per request and reuses it for 10 minutes, so a normal day uses a few dozen.
