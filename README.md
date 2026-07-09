# London Flat — Sell-Timing Forecaster

A private, zero-build static single-page app that forecasts **when might be a good time to
sell** a flat in London (N1 7TX, purchased March 2025 for £890,000), weighing recent
pricing, mortgage rates, the forecast trajectory, seasonality and political/macro factors.

It produces a single transparent **sell-timing signal** for four candidate windows *and*
the full factor-by-factor breakdown, with **charts**, **explanations** and **links to source
material** throughout. Every assumption is editable live via sliders.

> **Not financial advice.** This is an informational model. House-price and rate forecasts
> are uncertain and often wrong. Verify against the linked sources and a qualified adviser.

---

## What it does

- **Headline recommendation** — the best window (currently **Spring 2028** under base
  consensus) with a gauge and the top reasons.
- **Your position** — purchase, estimated current value, mortgage, equity, monthly payment
  now vs. after the fix ends, CGT status.
- **Sell-timing signal** — a weighted blend of five factors across four windows (now,
  Spring 2027, H2 2027, Spring 2028), shown as stacked contributions + a ranking table.
- **The factors, explained** — price trajectory, forecast scenarios, financing & ERC,
  seasonality, and political/macro, each with data, reasoning and source links.
- **Net proceeds** — projected cash in hand after mortgage, ERC, agent+VAT, legal, EPC and
  CGT (£0 as a main residence).
- **Scenario controls** — sliders for forecast scenario, remortgage rate, current value and
  per-year growth that recompute everything instantly.

All data is a curated snapshot gathered **30 June 2026** (sources linked in-app). The Bank
of England base-rate badge attempts a **live refresh** via a Cloudflare Pages Function.

## How the model works

The signal is a weighted sum of five factor scores, each in **−100 (wait) … +100 (sell here)**:

| Factor | Weight | What it captures |
| --- | --- | --- |
| Price trajectory | 30% | Projected sale value across windows + price momentum |
| Financing & ERC | 25% | 1% early-repayment charge while in the fix; extra interest from holding past the March 2027 fix at a higher remortgage rate |
| Net proceeds | 20% | Your personal cash-in-hand after all costs |
| Seasonality | 10% | Buyer-demand strength in the window's month (flats peak late spring) |
| Policy & macro | 15% | Time-aware tally of the political factors |

Weights and factor logic live in `assets/data/dataset.js` and `assets/js/model.js`.

## Project structure

```
london_flat/
├── index.html                 # single page
├── _headers                   # security + caching headers (Cloudflare Pages)
├── worker.js                  # Cloudflare Worker entry — serves assets + /api/rates
├── wrangler.jsonc             # Worker + static-assets deploy config
├── assets/
│   ├── css/styles.css
│   ├── data/dataset.js        # curated, sourced data + your figures (edit here)
│   └── js/
│       ├── finance.js         # amortization, ERC, net proceeds (pure)
│       ├── model.js           # weighted sell-timing signal (pure)
│       ├── charts.js          # dependency-free SVG charts
│       └── app.js             # rendering + interactivity
```

**Zero build.** No bundler, no npm install, no framework — native ES modules and inline SVG.
The app itself is **pure static** and renders entirely from the curated snapshot, so it works
on any static host. A tiny optional **Worker** (`worker.js`) adds a single `/api/rates` route
for live Bank-of-England data; if it isn't deployed the page silently keeps the snapshot. Zero
Trust Access works either way.

## Run locally

Because it uses ES modules, open it via a tiny local server (not `file://`):

```bash
cd london_flat
python3 -m http.server 8099
# visit http://localhost:8099
```

## Deploy to Cloudflare (Workers — static assets)

This is a pure static site, so it deploys exactly like any other zero-build static app:

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**.
3. Select `sk8905/london_flat` and the branch to deploy.
4. Build settings: **Framework preset `None`**, **Build command empty**, **Deploy/output
   directory `/`** (the repo root). No build step is needed.
5. **Deploy.** You get a `https://<name>.<account>.workers.dev` URL.

Every push to the connected branch redeploys automatically.

> **Cloudflare Pages** is an equally good target (`Workers & Pages → Create → Pages`) if your
> dashboard offers it. Either works — the site is the same static files.

### Live rates (Worker-native)

The header rate badges show the **curated snapshot** in `assets/data/dataset.js` by default, and
upgrade themselves to **live values** when deployed as a Worker (a small green `live` tag marks
the ones that did):

- `worker.js` exposes `GET /api/rates`, which fetches the Bank of England Interactive Database
  server-side in one multi-series request and returns JSON. Series used:
  - `IUDBEDR` → **Bank Rate** (base rate badge).
  - `IUMBV37` (60% LTV) and `IUMBV34` (75% LTV) 2-year fixed quoted mortgage rates → linearly
    interpolated to the **~70% LTV remortgage** badge. (BoE doesn't publish a 70% bucket; 70% is
    derived between the 60% and 75% series. These quoted rates update monthly.)
  - The **2-year swap** has no free official daily feed, so it stays on the snapshot (no `live`
    tag). Plug in a market-data provider, or derive it, if you want it live.
- The call is time-boxed (~4.5s), edge-cached 6h, and has a per-series snapshot fallback — any
  missing series keeps its snapshot silently.
- After first paint, `app.js` calls `/api/rates` **non-blocking** and swaps in each live value,
  tags it `live`, and updates the header "Last refresh / Latest item" line. If the route 404s
  (plain static hosting) or the upstream is unreachable, snapshots stay and nothing hangs.
- The BoE series codes are in `worker.js` (`SERIES`); if one returns no data in production the
  badge falls back to its snapshot — adjust the code there and redeploy.

To deploy with the Worker route, either connect the repo in the dashboard (Cloudflare
auto-detects `wrangler.jsonc`) or run:

```bash
npx wrangler deploy
```

`wrangler.jsonc` binds the repo root as static assets (`ASSETS`) with `run_worker_first: true`,
so the Worker handles every request: it serves `/api/rates` and stamps `Cache-Control: no-cache`
on HTML responses. That last part matters — the `[assets]` binding ignores the Pages-only
`_headers` file, so without it a cached `index.html` could keep pointing at old `?v=` module
files after a deploy. With it, the HTML always revalidates and picks up new builds immediately;
the versioned JS/CSS cache normally. If you ever see a stale build, hard-refresh once.

## Lock it down with Cloudflare Zero Trust (Access)

Restrict the whole site so **only `kenneds7@tcd.ie`** can open it.

1. **Enable Zero Trust:** Cloudflare dashboard → **Zero Trust**. Choose a team name
   (e.g. `your-team` → login domain `your-team.cloudflareaccess.com`). The Free plan covers
   up to 50 users.
2. **Add a login method:** Zero Trust → **Settings → Authentication**. The built-in
   **One-time PIN** works immediately (emails a code to verify the address) — no IdP needed.
3. **Create the Access application:** Zero Trust → **Access → Applications → Add an
   application → Self-hosted.**
   - **Application name:** `London Flat`
   - **Session duration:** e.g. 24 hours
   - **Application domain:** your deployed hostname, e.g. `londonflat.<account>.workers.dev`
     (add a second row for any custom domain later).
4. **Add a policy:**
   - **Policy name:** `Only me`
   - **Action:** `Allow`
   - **Include → Emails →** `kenneds7@tcd.ie`
   - (Leave everything else as deny-by-default.)
5. **Save.** Any visit now redirects to a Cloudflare Access login; only that email receives a
   working one-time PIN. Everyone else is blocked before the app loads.

> To add more people later, edit the **Only me** policy and add their emails, or switch the
> Include rule to an **Emails ending in** `@tcd.ie` rule.

### Signed-in identity & sign-out

The sidebar shows who you're signed in as and a **sign-out** button. These use Cloudflare
Access endpoints that exist automatically once the app is behind Access:

- Identity is read from `GET /cdn-cgi/access/get-identity` (returns your email/name). Outside
  Access — e.g. local preview — it simply shows "Local preview".
- The sign-out button links to `/cdn-cgi/access/logout`, which clears your Access session.

No configuration is required; it works as soon as the Access application is in place.

## Notifications

The header has a **notifications bell**. On each visit it diffs the live dataset against a
snapshot saved in the browser and flags, as unread alerts:

- **New N1 sales** added to `COMPS.rows`,
- a **change in the BoE base rate** (`RATES.baseRateNow`),
- a **≥10bps move in the 2-year swap** (`RATES.swap2yrNow`).

The first visit just seeds the snapshot silently (no spam). Opening the bell marks alerts read;
"Clear all" empties the log. Optionally, "Enable desktop alerts" requests the browser
Notification permission so new items also raise a native notification when the page loads.
(Because the site is static, alerts surface when you open it after a data refresh — they aren't
pushed in the background.)

## Keeping data fresh — daily routine

The **base rate** and the **~70% LTV remortgage rate** now refresh themselves live from the Bank
of England on every page load (see *Live rates* above) — the routine does **not** need to touch
those. It handles everything that has no live feed: new sales, forecasts, policy, £/m², HPI, the
2-year swap, and the snapshot fallbacks. Everything recomputes from `assets/data/dataset.js`.

Paste the block below into your daily (08:00) Claude Code routine:

```text
Refresh assets/data/dataset.js in the london_flat repo with the latest figures, then bump the
build and open a PR. Note: RATES.baseRateNow and RATES.remortgage70Now are fetched LIVE from the
Bank of England by the Worker, so do NOT hand-edit those (only refresh their snapshot fallbacks
if they've drifted far). Work through each item, keeping every value sourced; if nothing changed
today, make no PR.

1. Recent N1 sales — search HM Land Registry + Zoopla for newly-registered sold 2-bed
   new-build or purpose-built apartments in N1. Add each as a COMPS.rows entry
   {addr, date "YYYY-MM", price, beds, baths, type, sqm, lat, lng}, geocoding lat/lng from the
   street's postcode (checkmypostcode / postcodes.io). Keep only new-build/purpose-built.
   Update COMPS.asOf. (Each new row alerts me in the app.)
2. 2-year GBP swap — set RATES.swap2yrNow + swap2yrAsOf to the current 2-year SONIA swap (no
   live feed, so it's manual). A move of 10bps or more from the current value alerts me in-app.
3. Market mortgage fixes — update RATES.avg2yrFix / avg5yrFix and append to fix2yrSeries from
   Rightmove/Moneyfacts averages.
4. Bank Rate context — on an MPC decision day, append the new point to RATES.baseSeries and note
   RATES.nextDecision (the live badge already shows the current value).
5. £/m² comparables — refresh COMPARABLES.perSqm (low/median/high) and n1_7txAvg12m from the
   latest N1 Land Registry £/m² distribution.
6. Islington HPI / price history — extend PRICE_HISTORY.series with the newest UK HPI release
   and update the headline Islington figures in the Market tab copy if they changed.
7. Forecasts — if Savills / Knight Frank / Zoopla have revised, update FORECAST.scenarios
   (base/optimistic/pessimistic by year).
8. Policy & macro — reflect any Budget/tax changes in POLICY_FACTORS (mansion tax, Section 24
   landlord rates, SDLT, CGT) with correct effective dates; update the Market tab text.
9. Snapshot fallbacks — if the live values have drifted materially, update the fallbacks
   (RATES.baseRateNow/baseRateAsOf, RATES.remortgage70Now/AsOf) and the same FALLBACK block in
   worker.js so offline/no-Worker views aren't stale.
10. Sources — fix any SOURCES URLs/labels that have moved on (e.g. the latest HPI month page).
11. Stamp & ship — set META.asOf to today and bump META.build (e.g. "v36 · <today>"); also bump
    the ?v= query on every module import in index.html and the JS files so caches refresh.
    Commit, push, and confirm the deployed footer shows the new build.

Flag anything you couldn't verify from a primary source rather than guessing.
```

## Your inputs (as configured)

| Field | Value |
| --- | --- |
| Property | N1 7TX, Islington flat |
| Purchased | March 2025 — £890,000 |
| Mortgage | 70% LTV (£623,000), **4.38%** fixed, ends **March 2027** |
| Repayment | Capital & interest, 25-year term |
| ERC | 1% of outstanding balance while in the fix |
| Selling costs | Agent 1.25% + VAT, legal £1,500, EPC/misc £500 |
| Tax | Primary residence → **CGT exempt** (Private Residence Relief) |

All editable in `assets/data/dataset.js` (defaults) or live via the on-page sliders.
