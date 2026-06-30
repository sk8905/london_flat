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
├── assets/
│   ├── css/styles.css
│   ├── data/dataset.js        # curated, sourced data + your figures (edit here)
│   └── js/
│       ├── finance.js         # amortization, ERC, net proceeds (pure)
│       ├── model.js           # weighted sell-timing signal (pure)
│       ├── charts.js          # dependency-free SVG charts
│       └── app.js             # rendering + interactivity
└── functions/
    └── api/boe-rate.js        # Cloudflare Pages Function: live BoE base rate
```

**Zero build.** No bundler, no npm install, no framework — native ES modules and inline SVG.

## Run locally

Because it uses ES modules, open it via a tiny local server (not `file://`):

```bash
cd london_flat
python3 -m http.server 8099
# visit http://localhost:8099
```

The `/api/boe-rate` call will 404 locally (that's fine — the app falls back to the snapshot
rate). To exercise the Function locally, use Wrangler:

```bash
npx wrangler pages dev .
```

## Deploy to Cloudflare Pages

This repo is already wired for Cloudflare Pages (static assets + the `functions/` directory
are detected automatically — **no build command needed**).

### Option A — Git integration (recommended)

1. Push this repo to GitHub (see below).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the `sk8905/london_flat` repo and the branch you want to deploy.
4. Build settings:
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`  (the repo root)
5. **Save and Deploy.** You get a `https://london-flat.pages.dev` URL (name may vary).

Every push to the connected branch redeploys automatically. The
`functions/api/boe-rate.js` endpoint is live at `https://<your-project>.pages.dev/api/boe-rate`.

### Option B — Direct upload via Wrangler

```bash
npx wrangler pages deploy . --project-name london-flat
```

## Lock it down with Cloudflare Zero Trust (Access)

Restrict the whole site so **only `kenneds7@tcd.ie`** can open it.

1. **Enable Zero Trust:** Cloudflare dashboard → **Zero Trust**. Choose a team name
   (e.g. `your-team` → login domain `your-team.cloudflareaccess.com`). The Free plan covers
   up to 50 users.
2. **Add a login method:** Zero Trust → **Settings → Authentication**. The built-in
   **One-time PIN** works immediately (emails a code to verify the address) — no IdP needed.
   You can add Google/GitHub later if you prefer.
3. **Create the Access application:** Zero Trust → **Access → Applications → Add an
   application → Self-hosted.**
   - **Application name:** `London Flat`
   - **Session duration:** e.g. 24 hours
   - **Application domain:** your Pages hostname, e.g. `london-flat.pages.dev`
     (add a second row for any custom domain later).
4. **Add a policy:**
   - **Policy name:** `Only me`
   - **Action:** `Allow`
   - **Include → Emails →** `kenneds7@tcd.ie`
   - (Leave everything else as deny-by-default.)
5. **Save.** Now any visit to the site redirects to a Cloudflare Access login; only that
   email receives a working one-time PIN. Everyone else is blocked before the app loads —
   including the `/api/boe-rate` Function.

> To add more people later, edit the **Only me** policy and add their emails, or switch the
> Include rule to an **Emails ending in** `@tcd.ie` rule.

### Note on `*.pages.dev` and Access

Cloudflare Access protects custom domains and the project's `*.pages.dev` domain. If you find
the policy doesn't intercept the raw `pages.dev` preview URLs in your account, attach a free
custom subdomain (e.g. via a domain already on Cloudflare) to the Pages project and put the
Access application on that hostname — that always enforces.

## Keeping data fresh

Edit `assets/data/dataset.js` and commit. Everything (charts, signal, proceeds) recomputes
from that file. The most perishable values:

- `RATES.baseRateNow` / fix averages — refreshed live for the base rate via the Function;
  update the fix averages manually from the linked Rightmove/Moneyfacts pages.
- `PRICE_HISTORY.series` — extend with each new Land Registry UK HPI release.
- `FORECAST.scenarios` — update when Savills / Knight Frank / Zoopla revise.

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
