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

Three headline sections, plus the sell-timing tools:

1. **Local market — within 2 km of N1 7TX** (`Local market` tab). Recent listings and
   completed sales inside a **strict 2 km radius**: new listings per month, days on market,
   sold-vs-asking (£ and %), £/m², a map of sales + live listings, the latest **HPI** figures,
   the nearby **new-build pipeline**, and **RICS / estate-agent** price & activity forecasts.
2. **Our finances** (`Our finances` tab). Everything paid (deposit, SDLT, buying costs,
   interest and principal to date), what the mortgage is costing, and the **recoup-all-cash
   break-even** — the sale price at which net proceeds return every pound sunk in, shown as a
   waterfall, plus the projected net-proceeds-by-window chart.
3. **Rent vs buy** (`Rent vs buy` tab). Own this flat or rent the equivalent nearby, using
   **real local rental data**: the monthly economic cost of owning vs the rent, and total
   wealth over a chosen horizon (keep owning vs sell, invest the proceeds and rent).

Retained tools: the **When to sell** timing signal (weighted blend of five factors across four
windows), **Sell vs let** (keep-and-let vs sell, full UK tax), the **map**, the
**notifications** bell, and the **live rate badges**. Editable **Inputs** drive everything.

Local-market data is a curated snapshot from HM Land Registry, the EPC register and local
listing/planning records, designed to be refreshed from the **Homedata** feed (see
*Keeping data fresh*). Personal figures are a snapshot gathered **June 2026**; the BoE rate
badges attempt a **live refresh** via the Worker.

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
│       ├── finance.js         # amortization, ERC, net proceeds, recoup-all break-even (pure)
│       ├── model.js           # weighted sell-timing signal (pure)
│       ├── market.js          # 2 km local-market data layer + Homedata adapter (Section 1)
│       ├── ownrent.js         # own-vs-rent comparator (Section 3, pure)
│       ├── letting.js         # sell-vs-let comparison, UK tax aware (pure)
│       ├── charts.js          # dependency-free SVG charts
│       └── app.js             # rendering + interactivity
```

**Local-market data (`market.js`).** All Section-1 rows carry `lat`/`lng` and are filtered to
a strict 2 km radius of the N1 7TX centroid via a haversine distance. The curated constants are
the **offline fallback**; `applyHomedata(payload)` merges a live Homedata payload of the same
shape so the rest of the app keeps reading `market.js`. See *Keeping data fresh* for how the
daily routine populates it. **The Homedata API key is a secret** — it lives in the Worker
environment (`env.HOMEDATA_KEY`) or the routine's environment, and is **never committed**.

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

The header rate badges are **links to their source** (BoE) and show the **curated snapshot** in
`assets/data/dataset.js` by default, upgrading themselves to **live values** when deployed as a
Worker:

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
  and updates the header "Last refresh / Latest item" line. Each badge links to its BoE source.
  If the route 404s (plain static hosting) or the upstream is unreachable, snapshots stay and
  nothing hangs.
- The BoE series codes are in `worker.js` (`SERIES`); if one returns no data in production the
  badge falls back to its snapshot — adjust the code there and redeploy.

To deploy with the Worker route, either connect the repo in the dashboard (Cloudflare
auto-detects `wrangler.jsonc`) or run:

```bash
npx wrangler deploy
```

`wrangler.jsonc` binds the repo root as static assets (`ASSETS`) with `run_worker_first: true`,
so the Worker handles every request: it serves `/api/rates` and stamps
`Cache-Control: no-cache, must-revalidate` on all HTML, CSS and JS responses (images, fonts,
SVG and the manifest keep their defaults). That matters — the `[assets]` binding ignores the
Pages-only `_headers` file, so without it a cached copy could persist after a deploy. With it,
every HTML/CSS/JS file revalidates against its ETag and picks up new builds immediately, so
there is no need for `?v=` cache-busting query strings. If a device still shows a stale build
(e.g. an iOS Home-Screen web app), clear it once.

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
those. It handles everything that has no live feed: the **2 km local market** (`market.js`), new
sales, forecasts, policy, £/m², HPI, rents, the 2-year swap, and the snapshot fallbacks.
Sell-timing recomputes from `assets/data/dataset.js`; the local-market section reads `market.js`.

**Homedata (local market).** `market.js` is the adapter target for the
[Homedata](https://homedata.co.uk/) feed. The **free tier is ~100 calls/month (≈3/day)**, so the
data cannot be fetched per visit — the daily routine fetches it **once** and commits it as static
data. The API key is a **secret**: read it from `HOMEDATA_KEY` in the routine's environment (or
the Worker's `env.HOMEDATA_KEY`); **never commit the key** to the repo. Auth header is
`Authorization: Api-Key $HOMEDATA_KEY`. Network access to `homedata.co.uk` / `api.homedata.co.uk`
must be allow-listed for the routine's environment (see *Data sources to allow-list* below).

Paste the block below into your daily (08:00) Claude Code routine:

```text
Refresh assets/data/dataset.js in the london_flat repo with the latest figures, then bump the
build and commit directly to the deploy branch (see CLAUDE.md — no PR). Note: RATES.baseRateNow
and RATES.remortgage70Now are fetched LIVE from the
Bank of England by the Worker, so do NOT hand-edit those (only refresh their snapshot fallbacks
if they've drifted far). Work through each item, keeping every value sourced; if nothing changed
today, make no PR.

1. Recent N1 sales — search HM Land Registry + Zoopla for newly-registered sold 2-bed
   new-build or purpose-built apartments in N1. Add each as a COMPS.rows entry
   {addr, date "YYYY-MM", price, beds, baths, type, sqm, lat, lng}, geocoding lat/lng from the
   street's postcode (checkmypostcode / postcodes.io). Keep only new-build/purpose-built.
   Update COMPS.asOf. (Each new row alerts me in the app.)
2. 2-year GBP swap — FIRST copy the existing RATES.swap2yrNow into RATES.swap2yrPrev (so the
   badge shows today's day-over-day change), THEN set RATES.swap2yrNow + swap2yrAsOf to the
   current 2-year SONIA swap (no live feed, so it's manual). A move of 10bps or more alerts me.
   (baseRatePrev and remortgage70Prev are computed live by the Worker — leave those.)
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
11. Local market (2 km) — refresh assets/js/market.js from Homedata (key from $HOMEDATA_KEY in the
    environment — NEVER commit it; auth header "Authorization: Api-Key $HOMEDATA_KEY"). Update the
    rows in SALES (askingPrice, price, listedDate, soldDate, sqm, lat, lng), LISTINGS (asking,
    listedDate, status), LISTINGS_PER_MONTH.series, RENT.series + currentAvg2bed, HPI, NEW_BUILDS
    and FORECASTS. Keep every row within ~2 km of the N1 7TX centroid (51.5346, -0.0899). Set each
    block's asOf and flip its `curated:` flag to false once it holds live data. One Homedata pull
    per day only (free tier ≈100 calls/month). If Homedata is unreachable, leave the curated rows.
12. Stamp & ship — set META.asOf to today and bump META.build (e.g. "v76 · <today>"). Caches
    refresh automatically via the Worker's no-cache headers, so there is no `?v=` to bump.
    Commit and push to the deploy branch (see CLAUDE.md — no PR), then confirm the deployed
    footer shows the new build.

Flag anything you couldn't verify from a primary source rather than guessing.
```

### Data sources to allow-list

The routine (and any live fetch) needs outbound HTTPS to these hosts. If your environment uses a
network allow-list, add them:

| Host | Used for |
| --- | --- |
| `api.homedata.co.uk`, `homedata.co.uk` | Homedata — listings, days-on-market, sold-vs-asking, rents |
| `www.gov.uk`, `landregistry.data.gov.uk` | HM Land Registry sold prices & UK HPI |
| `api.postcodes.io` | Geocoding postcodes → lat/lng for the 2 km radius |
| `find-energy-certificate.service.gov.uk` | EPC floor areas (£/m²) |
| `www.planit.org.uk` | Planning applications — the new-build pipeline |
| `www.ons.gov.uk` | ONS Islington rents & house-price stats |
| `www.rics.org` | RICS Residential Market Survey (forecasts) |
| `www.bankofengland.co.uk` | Live base rate & quoted mortgage rates (Worker `/api/rates`) |

The app itself renders fully **without** any of these (curated fallback); they only power the
daily refresh and the live rate badges.

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
