// =============================================================================
// charts.js  —  Tiny dependency-free SVG charts (line, band, bar, diverging, gauge)
// -----------------------------------------------------------------------------
// All charts render into a container as inline SVG with a viewBox, so they scale
// fluidly. No external libraries — works offline and inside Zero Trust.
// =============================================================================

const SVGNS = "http://www.w3.org/2000/svg";
const fmtGBP = (n) =>
  "£" + Math.round(n).toLocaleString("en-GB");
const fmtGBPk = (n) =>
  "£" + (n / 1000).toFixed(0) + "k";
const fmtPct = (n) => n.toFixed(2) + "%";

export const fmt = { fmtGBP, fmtGBPk, fmtPct };

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function svgRoot(container, w, h) {
  container.innerHTML = "";
  const svg = el("svg", {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    class: "chart-svg",
  });
  container.appendChild(svg);
  return svg;
}

// niceTicks: returns ~count round numbers spanning [min,max].
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  if (!(step > 0) || !isFinite(lo) || !isFinite(hi)) return [min, max]; // guard bad inputs
  for (let v = lo; v <= hi + 1e-6 && ticks.length < 1000; v += step) ticks.push(v);
  return ticks;
}

// ---------------------------------------------------------------------------
// Multi-series line chart with optional shaded band (scenario range).
// opts: { series:[{name,color,dashed,points:[{x:label,y:number}]}],
//         band:{lower:[..], upper:[..], color}, yFormat, title, height }
// x is taken from the first series' point labels (categorical, evenly spaced).
// ---------------------------------------------------------------------------
export function lineChart(container, opts) {
  const W = 720, H = opts.height || 300;
  const m = { t: 16, r: 16, b: 42, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);

  const labels = opts.series[0].points.map((p) => p.x);
  const allY = [];
  opts.series.forEach((s) => s.points.forEach((p) => allY.push(p.y)));
  if (opts.band) {
    opts.band.lower.forEach((y) => allY.push(y));
    opts.band.upper.forEach((y) => allY.push(y));
  }
  if (opts.yRef != null) allY.push(opts.yRef);
  let yMin = Math.min(...allY), yMax = Math.max(...allY);
  const ticks = niceTicks(yMin, yMax, 5);
  yMin = ticks[0]; yMax = ticks[ticks.length - 1];

  const xAt = (i) => m.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const yAt = (v) => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const yFormat = opts.yFormat || ((v) => v.toFixed(0));

  // gridlines + y labels
  ticks.forEach((t) => {
    el("line", { x1: m.l, y1: yAt(t), x2: W - m.r, y2: yAt(t), class: "grid" }, svg);
    const tx = el("text", { x: m.l - 8, y: yAt(t) + 4, class: "axis-y" }, svg);
    tx.textContent = yFormat(t);
  });

  // x labels (thin out if many)
  const stepX = Math.ceil(labels.length / 8);
  labels.forEach((lab, i) => {
    if (i % stepX !== 0 && i !== labels.length - 1) return;
    const tx = el("text", { x: xAt(i), y: H - 14, class: "axis-x" }, svg);
    tx.textContent = lab;
  });

  // optional reference line (e.g. purchase price)
  if (opts.yRef != null) {
    el("line", { x1: m.l, y1: yAt(opts.yRef), x2: W - m.r, y2: yAt(opts.yRef), class: "ref-line" }, svg);
    const rt = el("text", { x: W - m.r, y: yAt(opts.yRef) - 6, class: "ref-label" }, svg);
    rt.setAttribute("text-anchor", "end");
    rt.textContent = opts.yRefLabel || "";
  }

  // band
  if (opts.band) {
    const up = opts.band.upper.map((y, i) => `${xAt(i)},${yAt(y)}`);
    const lo = opts.band.lower.map((y, i) => `${xAt(i)},${yAt(y)}`).reverse();
    el("polygon", { points: up.concat(lo).join(" "), fill: opts.band.color, opacity: 0.14 }, svg);
  }

  // series
  opts.series.forEach((s) => {
    const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.y)}`).join(" ");
    el("path", {
      d, fill: "none", stroke: s.color, "stroke-width": s.width || 2.5,
      "stroke-dasharray": s.dashed ? "6 5" : "0",
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }, svg);
    if (s.dots !== false && s.points.length <= 14) {
      s.points.forEach((p, i) => el("circle", { cx: xAt(i), cy: yAt(p.y), r: 3, fill: s.color }, svg));
    }
  });

  // markers (vertical lines at named x labels, e.g. fix-end)
  (opts.markers || []).forEach((mk) => {
    const i = labels.indexOf(mk.x);
    if (i < 0) return;
    el("line", { x1: xAt(i), y1: m.t, x2: xAt(i), y2: m.t + ih, class: "marker-line" }, svg);
    const t = el("text", { x: xAt(i) + 4, y: m.t + 12, class: "marker-label" }, svg);
    t.textContent = mk.label;
  });

  drawLegend(container, opts.series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })));
}

// ---------------------------------------------------------------------------
// Vertical bar chart. opts: { bars:[{label,value,color,sub}], yFormat, height,
//                             baseline (default 0) }
// ---------------------------------------------------------------------------
export function barChart(container, opts) {
  const W = 720, H = opts.height || 300;
  const m = { t: 24, r: 16, b: 56, l: 70 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);

  const vals = opts.bars.map((b) => b.value);
  const base = opts.baseline ?? 0;
  let yMin = Math.min(base, ...vals), yMax = Math.max(base, ...vals);
  const ticks = niceTicks(yMin, yMax, 5);
  yMin = ticks[0]; yMax = ticks[ticks.length - 1];
  const yAt = (v) => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const yFormat = opts.yFormat || ((v) => v.toFixed(0));

  ticks.forEach((t) => {
    el("line", { x1: m.l, y1: yAt(t), x2: W - m.r, y2: yAt(t), class: "grid" }, svg);
    const tx = el("text", { x: m.l - 8, y: yAt(t) + 4, class: "axis-y" }, svg);
    tx.textContent = yFormat(t);
  });

  const n = opts.bars.length;
  const slot = iw / n;
  const bw = Math.min(80, slot * 0.6);
  opts.bars.forEach((b, i) => {
    const cx = m.l + slot * i + slot / 2;
    const y0 = yAt(base), y1 = yAt(b.value);
    el("rect", {
      x: cx - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.abs(y1 - y0),
      rx: 4, fill: b.color || "#3b82f6",
    }, svg);
    const vt = el("text", { x: cx, y: Math.min(y0, y1) - 6, class: "bar-value" }, svg);
    vt.textContent = b.valueLabel || yFormat(b.value);
    const lt = el("text", { x: cx, y: H - 30, class: "bar-label" }, svg);
    lt.textContent = b.label;
    if (b.sub) {
      const st = el("text", { x: cx, y: H - 14, class: "bar-sub" }, svg);
      st.textContent = b.sub;
    }
  });
}

// ---------------------------------------------------------------------------
// Diverging horizontal bars for factor scores in [-100, 100].
// opts: { items:[{label,value,color}], height }
// ---------------------------------------------------------------------------
export function divergingBars(container, opts) {
  const W = 720, rowH = 34;
  const H = opts.items.length * rowH + 30;
  const m = { t: 10, r: 60, b: 20, l: 150 };
  const iw = W - m.l - m.r;
  const svg = svgRoot(container, W, H);
  const mid = m.l + iw / 2;
  const xAt = (v) => mid + (v / 100) * (iw / 2);

  el("line", { x1: mid, y1: m.t, x2: mid, y2: H - m.b, class: "axis-mid" }, svg);
  ["-100", "0", "+100"].forEach((lab, i) => {
    const x = [m.l, mid, W - m.r][i];
    const t = el("text", { x, y: H - 6, class: "axis-x" }, svg);
    t.textContent = lab;
  });

  opts.items.forEach((it, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    const x0 = mid, x1 = xAt(it.value);
    el("rect", {
      x: Math.min(x0, x1), y: cy - 9, width: Math.max(2, Math.abs(x1 - x0)), height: 18,
      rx: 3, fill: it.color || (it.value >= 0 ? "#16a34a" : "#dc2626"),
    }, svg);
    const lt = el("text", { x: m.l - 10, y: cy + 4, class: "row-label" }, svg);
    lt.setAttribute("text-anchor", "end");
    lt.textContent = it.label;
    const vt = el("text", { x: x1 + (it.value >= 0 ? 6 : -6), y: cy + 4, class: "row-value" }, svg);
    vt.setAttribute("text-anchor", it.value >= 0 ? "start" : "end");
    vt.textContent = (it.value >= 0 ? "+" : "") + it.value.toFixed(0);
  });
}

// ---------------------------------------------------------------------------
// Semicircular gauge for a signal in [-100, 100].
// ---------------------------------------------------------------------------
export function gauge(container, value, label) {
  const W = 320, H = 190;
  const svg = svgRoot(container, W, H);
  const cx = W / 2, cy = 150, r = 120;
  const a0 = Math.PI, a1 = 0; // left to right
  const polar = (ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang) * -1];

  // coloured arc segments
  const segs = [
    { from: -100, to: -40, color: "#dc2626" },
    { from: -40, to: -12, color: "#f59e0b" },
    { from: -12, to: 12, color: "#9ca3af" },
    { from: 12, to: 40, color: "#84cc16" },
    { from: 40, to: 100, color: "#16a34a" },
  ];
  const valToAng = (v) => a0 + ((v + 100) / 200) * (a1 - a0);
  segs.forEach((s) => {
    const A = valToAng(s.from), B = valToAng(s.to);
    const [x1, y1] = polar(A), [x2, y2] = polar(B);
    el("path", {
      d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`,
      fill: "none", stroke: s.color, "stroke-width": 16, "stroke-linecap": "butt",
    }, svg);
  });

  // needle
  const va = valToAng(Math.max(-100, Math.min(100, value)));
  const [nx, ny] = polar(va);
  el("line", { x1: cx, y1: cy, x2: nx, y2: ny, stroke: "#111827", "stroke-width": 4, "stroke-linecap": "round" }, svg);
  el("circle", { cx, cy, r: 7, fill: "#111827" }, svg);

  const vt = el("text", { x: cx, y: cy - 28, class: "gauge-value" }, svg);
  vt.textContent = (value >= 0 ? "+" : "") + value.toFixed(0);
  const lt = el("text", { x: cx, y: cy - 8, class: "gauge-label" }, svg);
  lt.textContent = label || "";
}

// ---------------------------------------------------------------------------
// Stacked contribution bars (per window): each factor's signed contribution.
// opts: { windows:[{label}], factors:[{key,label,color}], data: { winId: {key:val} } }
// ---------------------------------------------------------------------------
export function stackedContrib(container, windows, factors, height = 320) {
  const W = 720, H = height;
  const m = { t: 20, r: 16, b: 70, l: 60 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);

  // y range from min negative stack to max positive stack
  let lo = 0, hi = 0;
  windows.forEach((w) => {
    let pos = 0, neg = 0;
    factors.forEach((f) => {
      const v = w.contributions[f.key] || 0;
      if (v >= 0) pos += v; else neg += v;
    });
    hi = Math.max(hi, pos); lo = Math.min(lo, neg);
  });
  const ticks = niceTicks(lo, hi, 5);
  lo = ticks[0]; hi = ticks[ticks.length - 1];
  const yAt = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  ticks.forEach((t) => {
    el("line", { x1: m.l, y1: yAt(t), x2: W - m.r, y2: yAt(t), class: "grid" }, svg);
    const tx = el("text", { x: m.l - 8, y: yAt(t) + 4, class: "axis-y" }, svg);
    tx.textContent = (t > 0 ? "+" : "") + t.toFixed(0);
  });
  el("line", { x1: m.l, y1: yAt(0), x2: W - m.r, y2: yAt(0), class: "axis-mid" }, svg);

  const slot = iw / windows.length;
  const bw = Math.min(90, slot * 0.55);
  windows.forEach((w, i) => {
    const cx = m.l + slot * i + slot / 2;
    let posY = 0, negY = 0;
    factors.forEach((f) => {
      const v = w.contributions[f.key] || 0;
      if (v === 0) return;
      const start = v >= 0 ? posY : negY;
      const end = start + v;
      const y1 = yAt(start), y2 = yAt(end);
      el("rect", { x: cx - bw / 2, y: Math.min(y1, y2), width: bw, height: Math.abs(y2 - y1), fill: f.color }, svg);
      if (v >= 0) posY = end; else negY = end;
    });
    // net marker (composite)
    const yc = yAt(w.composite);
    el("line", { x1: cx - bw / 2 - 4, y1: yc, x2: cx + bw / 2 + 4, y2: yc, stroke: "#111827", "stroke-width": 2.5 }, svg);
    const lt = el("text", { x: cx, y: H - 44, class: "bar-label" }, svg);
    lt.textContent = w.window.label;
    const ct = el("text", { x: cx, y: H - 28, class: "bar-sub" }, svg);
    ct.textContent = "net " + (w.composite >= 0 ? "+" : "") + w.composite.toFixed(0);
  });

  drawLegend(container, factors.map((f) => ({ name: f.label, color: f.color })).concat([{ name: "Net signal", color: "#111827", line: true }]));
}

// shared legend renderer
function drawLegend(container, items) {
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  items.forEach((it) => {
    const span = document.createElement("span");
    span.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "legend-swatch" + (it.dashed ? " dashed" : "") + (it.line ? " line" : "");
    sw.style.background = it.line ? "transparent" : it.color;
    if (it.line) sw.style.borderTop = "3px solid " + it.color;
    span.appendChild(sw);
    const tx = document.createElement("span");
    tx.textContent = it.name;
    span.appendChild(tx);
    legend.appendChild(span);
  });
  container.appendChild(legend);
}
