# Handover note — Finance Law Refresher app

**Purpose of this note:** carry full context into a new Claude Code session pointed at the correct repo (e.g. `sk8905/lawschool`). Paste this as your first message, or add it to that repo. This session was scoped to `sk8905/london_flat` and cannot switch repos.

---

## 1. Who / what

- **User:** 10-years-qualified finance lawyer. Last 4.5 years **principal-side** at a **credit fund** focused on **real estate debt & equity**. Moving back to **private practice as a finance partner**. Jurisdiction assumed **English law / London** (unconfirmed — worth confirming). Target team's product mix not yet specified.
- **Goal:** a refresher learning plan (documentation, drafting, key case law) AND a tool to support it.
- **Decision made:** build a single app combining **(1) study tracker**, **(2) case-law & market-development tracker**, and **(4) drafting/negotiation playbook**. (Option 3 Anki, 5 feed digest, 6 BD CRM were deferred.)
- **Delivery constraint:** **zero-build static single-page app** (no npm/bundler/transpile; double-click `index.html` or host on GitHub Pages).

## 2. Gap analysis driving the plan (context, not just a reading list)

- **Seat gap (biggest):** in-house you *review/negotiate*; as partner you *own the draft & precedent*. Needs drafting reps, not reading.
- **Breadth gap:** RE-deep → must cover leveraged/acquisition, corporate/IG + RCFs, fund finance (subscription + NAV), private credit/direct lending, plus security/intercreditor/restructuring interfaces.
- **Currency gap:** ~5 years of case law, LMA refreshes, completed LIBOR→RFR transition, ESG/sustainable-lending docs, sanctions, maturing Part 26A.
- **Partner (non-legal) gap:** origination/BD, running matters/P&L, conflicts/risk, supervising leverage.
- **Asset to leverage:** buy-side/credit-committee experience is rare and valuable in partners — frame as re-acquiring the drafting seat + breadth, not remediation.

## 3. The 12-week plan (5 parallel workstreams) — this is seed content for Module 1

- **A — Documentation & drafting (core).** Anchor to LMA suite: Investment Grade; **Leveraged** (covenants, cov-lite, baskets, EBITDA, MFN, portability); **Real Estate Finance** (start here — home turf); **Intercreditor**; security docs. Reps: mark up leveraged agreement borrower-side then lender-side; draft term sheet + CP list from a fact pattern; reconcile against "what's market". References: Practical Law – Finance / LexisNexis B&F; Wright *Handbook of International Loan Documentation*; Fuller *Corporate Borrowing*; *Beale, Law of Security*. Note **LMA.Automate** (doc-automation platform, free member tier, AI-augmented).
- **B — Case law & currency.** See Module-2 seed list below. Habit: JIBFL; LexisNexis B&F case tracker + weekly highlights; Practical Law "what's market"; magic-circle/US-elite finance & R&I client alerts.
- **C — Product breadth.** Fund finance (subscription vs **NAV** — record ~$12.9bn NAV fund closes 2025); private credit/direct lending (~$1.5–2tn, unitranche, AGL, doc drift from LMA); leveraged/acquisition (certain funds); sustainable finance (GLP/SLP/SLLP refreshed Mar 2025).
- **D — Regulatory/risk.** LIBOR→RFR (SONIA/SOFR conventions, CAS); sanctions (post-2022 doc mechanics, OFSI); Basel 3.1; NSIA; 2026 reg-change horizon.
- **E — Partner transition.** 12-month BD/origination plan (warm buy-side relationships); matter budgeting/leverage/lock-up; conflicts/engagement risk.

## 4. Module-2 seed content — cases & developments

- **Restructuring (Part 26A) — top priority cluster:** *Re AGPS Bondco (Adler)* [2024] EWCA Civ 24; *Thames Water* [2025] EWCA Civ 475; *Petrofac* [2025] EWCA Civ 821 (CoA overturned sanction — genuine-negotiation + fair allocation); *Waldorf* [2025] EWHC 2181 (sanction refused); **new Sept-2025 Practice Statement** (pre-convening evidence of creditor engagement for CCCD).
- **Lending / security / guarantees:** *Waller-Edwards v One Savings Bank* [2025] UKSC 22 (Etridge / undue influence); *BTI 2014 v Sequana* [2022] UKSC 25 (creditor duty); *Lifestyle Equities v Ahmed* [2024] UKSC 17 & *LUX Films v Fowler* [2026] EWHC 963 (KB) (accessory/director liability — recovery vs guarantors).
- **Interpretation / MAC / EoD:** *Wood v Capita*, *Rainy Sky*; Covid-era MAC/drawstop commentary.
- **Market/reg developments to log as entries:** LMA doc refreshes + LMA.Automate; GLP/SLP/SLLP March-2025 update; LIBOR→RFR completion; NAV/fund-finance growth; private-credit FSB scrutiny into 2026.

## 5. App design (agreed)

**Stack (recommended defaults — user to confirm):**
- UI: **Preact + htm** via `esm.sh` (React model, no JSX build). Alternative considered: Alpine.js (lighter, more awkward at this scale).
- Styling: **Tailwind Play CDN** *or* hand-written CSS + `@media print`. (Self-contained CSS = more durable, slightly more work.)
- Data: seed content as **JS modules that `export` JSON** — NOT `fetch`ed (browsers block `fetch()` of local JSON under `file://`; `import` works).
- State: `localStorage` overlay + JSON export/import. **Local-first, private, no backend/telemetry.**
- Pin all CDN deps to exact versions for durability.

**File structure:**
```
index.html            # importmap + root mount + tab nav (the whole "build system")
app.js                # tabs/router (hash-based), store, export/import
components/  StudyTracker.js  CaseTracker.js  Playbook.js  Shared.js
data/        plan.js  cases.js  playbook.js      (seed, git-tracked)
lib/         store.js  (useLocalState, overlay-merge, export/import)
```

**Overlay persistence model (key idea):** seed = read-only/git-tracked; user state overlays by id.
```
localStorage["frp:tasks"]   → { "A3": {status, notes} }
localStorage["frp:cases"]   → { "case:petrofac": {read, notes} }
localStorage["frp:clauses"] → { "cl:mfn": {notes} }
localStorage["frp:custom"]  → user-added cases/clauses (keeps it "living")
```
Render = `seed.map(x => ({...x, ...overlay[x.id]}))`. Updating seed never clobbers notes. Export dumps all `frp:*` to timestamped JSON (backup / cross-device / hand-merge into `/data`).

**Data shapes:**
- Task: `{id, workstream:A–E, week, effort, title, resources[], relatedCases[], relatedClauses[]}`
- Case/dev: `{id, type: case|lma|regulatory|market, title, citation, court, date, category[], holding, whyItMatters, links[], relatedClauses[]}`
- Clause: `{id, doc: ig|leveraged|ref|intercreditor|security, section, title, purpose, borrowerAsk, lenderPushback, marketPosition, draftingNotes, relatedCases[], relatedTasks[]}`
- Shared `id` + `tags` spine → cross-link chips between modules; dashboard aggregates progress.

**Views:** Shell = tabs Dashboard·Plan·Case Law·Playbook + global search, hash router. M1 = kanban + by-week/by-workstream + progress bars. M2 = filterable table (facets type/category, search, read/unread, add-entry). M4 = doc rail + clause accordion (purpose/borrower ask/lender pushback/market position/notes) + **print stylesheet** for PDF handouts.

**Deploy:** double-click `index.html`, or **GitHub Pages** (stable per-origin localStorage; recommended). Nothing leaves the browser.

## 6. Where we left off / next actions

- **Not built yet** — design agreed only.
- **Open decisions for user:** (a) framework Preact+htm vs Alpine; (b) styling Tailwind CDN vs hand-CSS; (c) jurisdiction (assumed English/London); (d) target team product mix (for tailoring seed content).
- **Build order:** Phase 1 shell + Module 1 (seeded plan, overlay, export/import) → Phase 2 Module 2 (cases seeded) → Phase 3 Module 4 (leveraged + intercreditor clauses first, then IG/REF/security) → Phase 4 cross-links + dashboard + print CSS.
- **First ask to make in the new session:** "Build Phase 1" (or all three modules scaffolded at once), in repo `sk8905/lawschool`.
