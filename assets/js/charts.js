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
  // Cap the on-screen width to the viewBox width so 1 SVG unit ≈ 1 CSS pixel —
  // this keeps label/object sizes consistent regardless of the panel width.
  svg.style.maxWidth = w + "px";
  container.appendChild(svg);
  return svg;
}

// Chart width = the container's actual rendered width (so text renders ~1:1),
// clamped to a sensible band. Falls back when the container is hidden (width 0).
function chartW(container) {
  const c = container && container.clientWidth;
  return Math.min(Math.max(c && c > 60 ? c : 680, 300), 900);
}

// Small unit label at the top-left of the y-axis (e.g. "£ THOUSANDS", "SIGNAL PTS").
function yUnitLabel(svg, text) {
  if (!text) return;
  const t = el("text", { x: 4, y: 11, class: "axis-unit" }, svg);
  t.textContent = text;
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
  const W = chartW(container), H = opts.height || 300;
  const m = { t: 16, r: 16, b: 42, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);
  yUnitLabel(svg, opts.yUnit);

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

  // x labels: pick ~5 EVENLY spaced indices incl. first & last, so dense monthly
  // series don't overlap on mobile and the last two never collide. First label is
  // left-aligned, last right-aligned so they can't clip at the SVG edges.
  const target = Math.min(opts.maxXLabels || 5, labels.length);
  const showIdx = new Set();
  for (let k = 0; k < target; k++) showIdx.add(Math.round((k * (labels.length - 1)) / (target - 1)));
  labels.forEach((lab, i) => {
    if (!showIdx.has(i)) return;
    const isLast = i === labels.length - 1;
    const anchor = i === 0 ? "start" : isLast ? "end" : "middle";
    const x = i === 0 ? m.l : isLast ? W - m.r : xAt(i);
    const tx = el("text", { x, y: H - 14, class: "axis-x", style: "text-anchor:" + anchor }, svg);
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

  // markers (vertical lines at named x labels, e.g. fix-end). Put the label on the
  // left of the line when the line sits in the right third, so it can't clip.
  (opts.markers || []).forEach((mk) => {
    const i = labels.indexOf(mk.x);
    if (i < 0) return;
    const mx = xAt(i);
    el("line", { x1: mx, y1: m.t, x2: mx, y2: m.t + ih, class: "marker-line" }, svg);
    const rightSide = mx > m.l + iw * 0.6;
    const t = el("text", { x: mx + (rightSide ? -4 : 4), y: m.t + 12, class: "marker-label", style: "text-anchor:" + (rightSide ? "end" : "start") }, svg);
    t.textContent = mk.label;
  });

  drawLegend(container, opts.series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })));
}

// ---------------------------------------------------------------------------
// Dual-axis line chart: one shared X, two independent Y scales (left + right),
// each coloured to its series. opts: { xLabels:[], height,
//   left:{name,color,values:[],format}, right:{name,color,values:[],format},
//   marker:{index,label} }
// ---------------------------------------------------------------------------
export function dualAxisLine(container, opts) {
  const W = chartW(container), H = opts.height || 280;
  const m = { t: 16, r: 64, b: 44, l: 66 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);

  const n = opts.xLabels.length;
  const xAt = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const scale = (vals) => { const t = niceTicks(Math.min(...vals), Math.max(...vals), 5); return { min: t[0], max: t[t.length - 1], ticks: t }; };
  const L = scale(opts.left.values), R = scale(opts.right.values);
  const yL = (v) => m.t + ih - ((v - L.min) / (L.max - L.min)) * ih;
  const yR = (v) => m.t + ih - ((v - R.min) / (R.max - R.min)) * ih;
  const fmtL = opts.left.format || String, fmtR = opts.right.format || String;

  // gridlines from the left scale; coloured left-axis labels
  L.ticks.forEach((t) => {
    el("line", { x1: m.l, y1: yL(t), x2: W - m.r, y2: yL(t), class: "grid" }, svg);
    const tx = el("text", { x: m.l - 8, y: yL(t) + 4, class: "axis-y" }, svg);
    tx.setAttribute("fill", opts.left.color); tx.textContent = fmtL(t);
  });
  // right-axis labels
  R.ticks.forEach((t) => {
    const tx = el("text", { x: W - m.r + 8, y: yR(t) + 4, class: "axis-y", style: "text-anchor:start" }, svg);
    tx.setAttribute("fill", opts.right.color); tx.textContent = fmtR(t);
  });
  // x labels (thin to every other when crowded so they never overlap)
  const stepX = n > 6 ? 2 : 1;
  opts.xLabels.forEach((lab, i) => {
    const isLast = i === n - 1;
    if (i % stepX !== 0 && !isLast) return;
    const anchor = i === 0 ? "start" : isLast ? "end" : "middle";
    const x = i === 0 ? m.l : isLast ? W - m.r : xAt(i);
    const tx = el("text", { x, y: H - 14, class: "axis-x", style: "text-anchor:" + anchor }, svg);
    tx.textContent = lab;
  });
  // current-rate marker
  if (opts.marker && opts.marker.index != null) {
    const mi = opts.marker.index;
    el("line", { x1: xAt(mi), y1: m.t, x2: xAt(mi), y2: m.t + ih, class: "marker-line" }, svg);
    const t = el("text", { x: xAt(mi) + 4, y: m.t + 12, class: "marker-label" }, svg);
    t.textContent = opts.marker.label || "";
  }
  const drawSeries = (vals, yFn, color) => {
    const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yFn(v)}`).join(" ");
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    if (vals.length <= 14) vals.forEach((v, i) => el("circle", { cx: xAt(i), cy: yFn(v), r: 3, fill: color }, svg));
  };
  drawSeries(opts.left.values, yL, opts.left.color);
  drawSeries(opts.right.values, yR, opts.right.color);

  // Optional forecast rate-path overlay: year-labelled markers placed along both
  // curves at the swap-implied future mortgage rates, so you can read off the
  // price & time-to-sell if rates follow that path. opts.xValues = numeric rates.
  if (opts.forecast && opts.forecast.length && opts.xValues) {
    const xv = opts.xValues, lo = xv[0], hi = xv[xv.length - 1];
    const fx = (rate) => m.l + ((Math.max(lo, Math.min(hi, rate)) - lo) / (hi - lo)) * iw;
    const lerp = (vals, rate) => {
      const r = Math.max(lo, Math.min(hi, rate));
      let pos = 0;
      for (let i = 0; i < xv.length - 1; i++) { if (r >= xv[i] && r <= xv[i + 1]) { pos = i + (r - xv[i]) / (xv[i + 1] - xv[i]); break; } }
      const i0 = Math.floor(pos), i1 = Math.min(vals.length - 1, i0 + 1), f = pos - i0;
      return vals[i0] * (1 - f) + vals[i1] * f;
    };
    const pline = opts.forecast.map((fc) => `${fx(fc.rate)},${yL(lerp(opts.left.values, fc.rate))}`);
    const dline = opts.forecast.map((fc) => `${fx(fc.rate)},${yR(lerp(opts.right.values, fc.rate))}`);
    el("polyline", { points: pline.join(" "), fill: "none", stroke: opts.left.color, "stroke-width": 1.5, "stroke-dasharray": "2 3", opacity: 0.7 }, svg);
    el("polyline", { points: dline.join(" "), fill: "none", stroke: opts.right.color, "stroke-width": 1.5, "stroke-dasharray": "2 3", opacity: 0.7 }, svg);
    opts.forecast.forEach((fc, k) => {
      const x = fx(fc.rate);
      const py = yL(lerp(opts.left.values, fc.rate));
      el("circle", { cx: x, cy: py, r: 4, fill: "#fff", stroke: opts.left.color, "stroke-width": 2 }, svg);
      el("circle", { cx: x, cy: yR(lerp(opts.right.values, fc.rate)), r: 4, fill: "#fff", stroke: opts.right.color, "stroke-width": 2 }, svg);
      // stagger labels above/below so near-coincident dots (flat curve) stay legible
      const t = el("text", { x, y: k % 2 === 0 ? py - 9 : py + 17, class: "axis-x", style: "text-anchor:middle;font-weight:700" }, svg);
      t.setAttribute("fill", opts.left.color);
      t.textContent = fc.label;
    });
  }
  drawLegend(container, [{ name: opts.left.name, color: opts.left.color }, { name: opts.right.name, color: opts.right.color }]);
}

// ---------------------------------------------------------------------------
// Vertical bar chart. opts: { bars:[{label,value,color,sub}], yFormat, height,
//                             baseline (default 0) }
// ---------------------------------------------------------------------------
export function barChart(container, opts) {
  const W = chartW(container), H = opts.height || 300;
  const m = { t: 24, r: 16, b: 56, l: 70 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);
  yUnitLabel(svg, opts.yUnit);

  const vals = opts.bars.map((b) => b.value);
  const base = opts.baseline ?? 0;
  const extra = opts.yRef != null ? [opts.yRef] : [];
  if (opts.overlay && Array.isArray(opts.overlay.values)) extra.push(...opts.overlay.values.filter((v) => Number.isFinite(v)));
  let yMin = Math.min(base, ...vals, ...extra), yMax = Math.max(base, ...vals, ...extra);
  const ticks = niceTicks(yMin, yMax, 5);
  yMin = ticks[0]; yMax = ticks[ticks.length - 1];
  const yAt = (v) => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const yFormat = opts.yFormat || ((v) => v.toFixed(0));

  ticks.forEach((t) => {
    el("line", { x1: m.l, y1: yAt(t), x2: W - m.r, y2: yAt(t), class: "grid" }, svg);
    const tx = el("text", { x: m.l - 8, y: yAt(t) + 4, class: "axis-y" }, svg);
    tx.textContent = yFormat(t);
  });

  // optional reference line (e.g. total cash invested)
  if (opts.yRef != null) {
    el("line", { x1: m.l, y1: yAt(opts.yRef), x2: W - m.r, y2: yAt(opts.yRef), class: "ref-line" }, svg);
    if (opts.yRefLabel) {
      const rt = el("text", { x: m.l + 4, y: yAt(opts.yRef) - 5, class: "ref-label" }, svg);
      rt.textContent = opts.yRefLabel;
    }
  }

  const n = opts.bars.length;
  const slot = iw / n;
  const bw = Math.min(116, slot * 0.62);
  // Thin x-labels so they never overlap: keep roughly one label per ~46px, and
  // always show the last bar's label. Or, if `labelEvery` is set, label strictly
  // every Nth bar (e.g. a monthly series labelled once a quarter).
  const labelStep = Math.max(1, Math.round(46 / slot));
  const labelEvery = opts.labelEvery || null;
  // optional per-bar axis notches (e.g. a tick for every month)
  if (opts.xTicks) {
    const yb = yAt(base);
    opts.bars.forEach((b, i) => {
      const cx = m.l + slot * i + slot / 2;
      el("line", { x1: cx, y1: yb, x2: cx, y2: yb + 5, stroke: "var(--muted)", "stroke-width": 1, opacity: 0.55 }, svg);
    });
  }
  opts.bars.forEach((b, i) => {
    const cx = m.l + slot * i + slot / 2;
    const y0 = yAt(base), y1 = yAt(b.value);
    el("rect", {
      x: cx - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.abs(y1 - y0),
      rx: 4, fill: b.color || "#33566b",
    }, svg);
    if (!opts.hideValues) {
      const vt = el("text", { x: cx, y: Math.min(y0, y1) - 6, class: "bar-value" }, svg);
      vt.textContent = b.valueLabel || yFormat(b.value);
    }
    const showLabel = labelEvery ? (i % labelEvery === 0) : (i % labelStep === 0 || i === n - 1);
    if (showLabel) {
      const lt = el("text", { x: cx, y: H - 30, class: "bar-label" }, svg);
      lt.textContent = b.label;
    }
    if (b.sub) {
      const st = el("text", { x: cx, y: H - 14, class: "bar-sub" }, svg);
      st.textContent = b.sub;
    }
  });

  // optional overlay line across the bars (e.g. break-even vs selling now & investing)
  if (opts.overlay && Array.isArray(opts.overlay.values) && opts.overlay.values.length === n) {
    const ov = opts.overlay, col = ov.color || "#a06a3c";
    const cxAt = (i) => m.l + slot * i + slot / 2;
    const pts = ov.values.map((v, i) => `${cxAt(i)},${yAt(v)}`).join(" ");
    el("polyline", { points: pts, fill: "none", stroke: col, "stroke-width": 2,
      "stroke-dasharray": "5 4", "stroke-linejoin": "round" }, svg);
    ov.values.forEach((v, i) => el("circle", { cx: cxAt(i), cy: yAt(v), r: 3, fill: col }, svg));
    if (ov.label) {
      const t = el("text", { x: cxAt(n - 1), y: yAt(ov.values[n - 1]) - 9, class: "overlay-label" }, svg);
      t.setAttribute("text-anchor", "end");
      t.textContent = ov.label;
    }
  }
}

// ---------------------------------------------------------------------------
// Diverging horizontal bars for factor scores in [-100, 100].
// opts: { items:[{label,value,color}], height }
// ---------------------------------------------------------------------------
export function divergingBars(container, opts) {
  const W = chartW(container), rowH = 34;
  const H = opts.items.length * rowH + 30;
  // reserve a fixed value column on the right (valW) so numbers never collide
  // with bars or row labels at any width.
  const valW = 46;
  const m = { t: 10, r: 16 + valW, b: 20, l: 148 };
  const iw = W - m.l - m.r;
  const svg = svgRoot(container, W, H);
  const mid = m.l + iw / 2;
  const xAt = (v) => mid + (v / 100) * (iw / 2);
  const valX = W - valW + 2; // left edge of the value column

  el("line", { x1: mid, y1: m.t, x2: mid, y2: H - m.b, class: "axis-mid" }, svg);
  [["-100", m.l, "middle"], ["0", mid, "middle"], ["+100", m.l + iw, "middle"]].forEach(([lab, x, anc]) => {
    const t = el("text", { x, y: H - 6, class: "axis-x", style: "text-anchor:" + anc }, svg);
    t.textContent = lab;
  });

  opts.items.forEach((it, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    const x0 = mid, x1 = xAt(it.value);
    el("rect", {
      x: Math.min(x0, x1), y: cy - 9, width: Math.max(2, Math.abs(x1 - x0)), height: 18,
      rx: 3, fill: it.color || (it.value >= 0 ? "#3a6b54" : "#9c4040"),
    }, svg);
    const lt = el("text", { x: m.l - 12, y: cy + 4, class: "row-label" }, svg);
    lt.setAttribute("text-anchor", "end");
    lt.textContent = it.label;
    // value in the fixed right-hand column (never overlaps a bar or the labels)
    const vt = el("text", { x: valX, y: cy + 4, class: "row-value" }, svg);
    vt.setAttribute("text-anchor", "start");
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
    { from: -100, to: -40, color: "#9c4040" },
    { from: -40, to: -12, color: "#9a7b4f" },
    { from: -12, to: 12, color: "#9ca3af" },
    { from: 12, to: 40, color: "#84cc16" },
    { from: 40, to: 100, color: "#3a6b54" },
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
export function stackedContrib(container, windows, factors, height = 320, yUnit) {
  const W = chartW(container), H = height;
  const m = { t: 20, r: 16, b: 70, l: 60 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H);
  yUnitLabel(svg, yUnit);

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
  const bw = Math.min(116, slot * 0.6);
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

// ---------------------------------------------------------------------------
// Location map — real OpenStreetMap basemap (CARTO light raster tiles) with the
// sales overlaid as pins. No mapping library: tiles are plain <img> elements
// positioned in a responsive % grid, markers are absolutely-positioned divs.
// Needs network for the tile images; if they fail, the pins still show on the
// map's background fill. opts.points: [{lat,lng,n,you,tip,plain}]
// ---------------------------------------------------------------------------
const lon2px = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z) * 256;
const lat2px = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * 256;
};

export function scatterMap(container, opts) {
  const pts = (opts.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  container.innerHTML = "";
  if (!pts.length) return;

  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  let latMin = Math.min(...lats), latMax = Math.max(...lats);
  let lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const padLat = (latMax - latMin) * 0.35 || 0.004, padLng = (lngMax - lngMin) * 0.35 || 0.004;
  latMin -= padLat; latMax += padLat; lngMin -= padLng; lngMax += padLng;

  // pick the highest zoom that keeps the whole area within ~1024px
  let z = 17;
  for (; z > 10; z--) {
    const w = Math.abs(lon2px(lngMax, z) - lon2px(lngMin, z));
    const h = Math.abs(lat2px(latMin, z) - lat2px(latMax, z));
    if (Math.max(w, h) <= 1024) break;
  }
  const xMin = lon2px(lngMin, z), xMax = lon2px(lngMax, z);
  const yMin = lat2px(latMax, z), yMax = lat2px(latMin, z); // y grows southward
  const Wpx = xMax - xMin, Hpx = yMax - yMin;

  const wrap = document.createElement("div");
  wrap.className = "map-tilewrap";
  wrap.style.aspectRatio = Wpx + " / " + Hpx;
  container.appendChild(wrap);

  // tile layer
  const nTiles = Math.pow(2, z);
  const pct = (v, span) => (v / span) * 100 + "%";
  for (let tx = Math.floor(xMin / 256); tx <= Math.floor(xMax / 256); tx++) {
    for (let ty = Math.floor(yMin / 256); ty <= Math.floor(yMax / 256); ty++) {
      if (ty < 0 || ty >= nTiles) continue;
      const wx = ((tx % nTiles) + nTiles) % nTiles;
      const img = document.createElement("img");
      img.className = "map-tile"; img.alt = ""; img.loading = "lazy";
      img.src = `https://a.basemaps.cartocdn.com/light_all/${z}/${wx}/${ty}@2x.png`;
      img.style.left = pct(tx * 256 - xMin, Wpx);
      img.style.top = pct(ty * 256 - yMin, Hpx);
      img.style.width = pct(256, Wpx);
      img.style.height = pct(256, Hpx);
      wrap.appendChild(img);
    }
  }

  const attr = document.createElement("div");
  attr.className = "map-attr";
  attr.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
  wrap.appendChild(attr);
  const compass = document.createElement("div");
  compass.className = "map-compass2"; compass.textContent = "N ↑";
  wrap.appendChild(compass);

  // Tooltip lives on the outer container (not the clipped tile wrap) so it can
  // extend above pins near the map's top edge.
  container.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "map-tip";
  container.appendChild(tip);

  // marker positions in intrinsic px. Only a small separation (just over one pin
  // diameter) so pins stay at their true geographic spot but never fully overlap.
  const placed = pts.map((p) => ({ ...p, x: lon2px(p.lng, z) - xMin, y: lat2px(p.lat, z) - yMin }));
  const minD = 30;
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        if (d < minD) {
          const push = (minD - d) / 2, ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        }
      }
    }
  }
  placed.forEach((p) => { p.x = Math.max(14, Math.min(Wpx - 14, p.x)); p.y = Math.max(14, Math.min(Hpx - 16, p.y)); });

  [...placed].sort((a, b) => (a.you === b.you ? 0 : a.you ? 1 : -1)).forEach((p) => {
    const mk = document.createElement("div");
    mk.className = "map-marker2" + (p.you ? " you" : "");
    mk.style.left = pct(p.x, Wpx); mk.style.top = pct(p.y, Hpx);
    mk.innerHTML = p.you
      ? '<span class="map-dot you"></span><span class="map-youlbl">Your flat</span>'
      : `<span class="map-dot${p.listing ? " listing" : ""}">${p.n}</span>`;
    mk.title = p.plain || "";
    wrap.appendChild(mk);
    const show = (e) => {
      const cr = container.getBoundingClientRect();
      tip.innerHTML = p.tip || p.plain || "";
      tip.style.left = (e.clientX - cr.left) + "px";
      tip.style.top = (e.clientY - cr.top) + "px";
      tip.classList.add("show");
    };
    mk.addEventListener("mouseenter", show);
    mk.addEventListener("mousemove", show);
    mk.addEventListener("mouseleave", () => tip.classList.remove("show"));
  });
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

// ---------------------------------------------------------------------------
// Sparkline — a tiny axis-free trend line for inline KPI use. `values` run
// oldest → newest; the last point gets a dot. Colour signals good/bad direction.
// ---------------------------------------------------------------------------
export function sparkline(container, values, opts = {}) {
  const W = opts.width || 62, H = opts.height || 18, pad = 2;
  const vals = (values || []).filter(Number.isFinite);
  const svg = svgRoot(container, W, H);
  if (vals.length < 2) return;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  const x = (i) => pad + (i / (vals.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - (span < 1e-9 ? 0.5 : (v - min) / span) * (H - 2 * pad);
  const color = opts.color || "#4a7c8c";
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  el("path", { d, fill: "none", stroke: color, "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
  el("circle", { cx: x(vals.length - 1).toFixed(1), cy: y(vals[vals.length - 1]).toFixed(1), r: 2.1, fill: color }, svg);
}
