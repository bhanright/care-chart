// Trends: small hand-drawn SVG charts of the daily totals over 7 to 90 days.
// One measure per chart and one y-axis each; hovering a bar or point shows its value.

import { formatFluid, ML_PER_FLUID_OUNCE } from "../entry-types.js";
import { dailySummaries } from "../summaries.js";
import { addDays, dateKey, formatDayKey, startOfDay } from "../time.js";
import { h, windowBox } from "../ui.js";

export const trendsState = { days: 14 };

export function trendsRange(now = new Date()) {
  const lastDay = dateKey(now);
  return { from: startOfDay(addDays(lastDay, -(trendsState.days - 1))), to: startOfDay(addDays(lastDay, 1)) };
}

const CHART_WIDTH = 520;
const CHART_HEIGHT = 190;
const MARGIN = { top: 14, right: 12, bottom: 26, left: 40 };
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svg(tag, attributes = {}, ...children) {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  for (const child of children.flat()) if (child) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}

function niceMaximum(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

function shortDay(day) {
  return formatDayKey(day, { month: "numeric", day: "numeric" });
}

/**
 * Draws one chart. `series` = [{ label, values: (number|null)[], color }]; bars for a
 * single series of counts or totals, lines otherwise. `goal` draws a dashed target line.
 */
function chart({ days, series, kind = "bar", minimum = 0, maximum = null, goal = null, format = (value) => String(Math.round(value)) }) {
  const plotWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const allValues = series.flatMap((item) => item.values).filter((value) => value !== null);
  const top = maximum ?? niceMaximum(Math.max(...allValues, goal ?? 0, minimum + 1));
  const y = (value) => MARGIN.top + plotHeight - ((value - minimum) / (top - minimum)) * plotHeight;
  const slot = plotWidth / days.length;
  const x = (index) => MARGIN.left + slot * index + slot / 2;

  const root = svg("svg", { class: "chart", viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, role: "img" });
  for (let step = 0; step <= 4; step++) {
    const value = minimum + ((top - minimum) * step) / 4;
    root.append(
      svg("line", { class: step === 0 ? "axis" : "gridline", x1: MARGIN.left, x2: CHART_WIDTH - MARGIN.right, y1: y(value), y2: y(value) }),
      svg("text", { x: MARGIN.left - 6, y: y(value) + 4, "text-anchor": "end" }, format(value)),
    );
  }
  const labelEvery = Math.ceil(days.length / 10);
  days.forEach((day, index) => {
    if (index % labelEvery === 0 || index === days.length - 1) {
      root.append(svg("text", { x: x(index), y: CHART_HEIGHT - 8, "text-anchor": "middle" }, shortDay(day.day)));
    }
  });
  if (goal) {
    root.append(svg("line", { class: "goal", x1: MARGIN.left, x2: CHART_WIDTH - MARGIN.right, y1: y(goal), y2: y(goal) }));
  }

  if (kind === "bar") {
    const barWidth = Math.max(3, Math.min(28, slot - 4));
    series[0].values.forEach((value, index) => {
      if (value === null || days[index].isFuture) return;
      const height = Math.max(value > 0 ? 2 : 0, y(minimum) - y(value));
      const radius = Math.min(4, barWidth / 2, height);
      const left = x(index) - barWidth / 2;
      const topEdge = y(minimum) - height;
      // Rounded at the data end only, square on the baseline.
      const path = `M${left},${y(minimum)} V${topEdge + radius} Q${left},${topEdge} ${left + radius},${topEdge} H${left + barWidth - radius} Q${left + barWidth},${topEdge} ${left + barWidth},${topEdge + radius} V${y(minimum)} Z`;
      root.append(svg("path", { d: path, fill: series[0].color, "data-tip": `${shortDay(days[index].day)}: ${format(value)}` }));
      // A larger invisible target makes thin bars easy to hover or tap.
      root.append(svg("rect", { x: x(index) - slot / 2, y: MARGIN.top, width: slot, height: plotHeight, fill: "transparent", "data-tip": `${shortDay(days[index].day)}: ${format(value)}` }));
    });
  } else {
    for (const item of series) {
      let path = "";
      item.values.forEach((value, index) => {
        if (value === null) return;
        path += `${path && item.values[index - 1] !== null ? "L" : "M"}${x(index)},${y(value)} `;
      });
      root.append(svg("path", { d: path, fill: "none", stroke: item.color, "stroke-width": 2, "stroke-linejoin": "round" }));
      item.values.forEach((value, index) => {
        if (value === null) return;
        root.append(svg("circle", { cx: x(index), cy: y(value), r: 4, fill: item.color, stroke: "var(--field)", "stroke-width": 2 }));
        root.append(svg("circle", { cx: x(index), cy: y(value), r: 11, fill: "transparent", "data-tip": `${shortDay(days[index].day)} ${item.label}: ${format(value)}` }));
      });
    }
  }
  return root;
}

function chartWindow(title, subtitle, chartElement, legend = null) {
  return windowBox({ title, extra: subtitle },
    h("div", { class: "well", style: { padding: "6px" } }, chartElement),
    legend ? h("div", { class: "chart-legend" }, legend.map((item) => h("span", { style: { "--swatch": item.color } }, item.label))) : null);
}

function hasAny(values) {
  return values.some((value) => value !== null && value !== 0);
}

function emptyChart(title, message) {
  return windowBox({ title }, h("div", { class: "empty" }, message));
}

export function renderTrends(context) {
  const now = context.now();
  const lastDay = dateKey(now);
  const firstDay = addDays(lastDay, -(trendsState.days - 1));
  const days = dailySummaries(context, firstDay, lastDay);
  const unit = context.preferences.fluidUnit;
  const pick = (getter) => days.map(getter);
  const fluidValues = pick((day) => unit === "ml" ? day.fluidMl : day.fluidMl / ML_PER_FLUID_OUNCE);
  const goal = context.preferences.dailyFluidGoalMl ? (unit === "ml" ? context.preferences.dailyFluidGoalMl : context.preferences.dailyFluidGoalMl / ML_PER_FLUID_OUNCE) : null;

  const charts = [];
  charts.push(chartWindow("Fluid intake per day", goal ? `dashed line = goal ${formatFluid(context.preferences.dailyFluidGoalMl, unit)}` : unit === "ml" ? "mL" : "fl oz",
    chart({ days, series: [{ label: "Fluids", values: fluidValues, color: SERIES[0] }], goal, format: (value) => `${Math.round(value)}` })));

  const adherence = pick((day) => day.scheduledDue ? (day.scheduledGiven / day.scheduledDue) * 100 : null);
  charts.push(hasAny(adherence)
    ? chartWindow("Scheduled doses given", "% of doses due so far", chart({ days, series: [{ label: "Given", values: adherence, color: SERIES[0] }], maximum: 100, format: (value) => `${Math.round(value)}%` }))
    : emptyChart("Scheduled doses given", "No scheduled doses in this period."));

  charts.push(chartWindow("Bowel movements per day", "count",
    chart({ days, series: [{ label: "Bowel movements", values: pick((day) => day.bowelCount), color: SERIES[0] }], format: (value) => value.toFixed(value % 1 ? 1 : 0) })));

  charts.push(chartWindow("Urinations per day", "count",
    chart({ days, series: [{ label: "Urinations", values: pick((day) => day.urineCount), color: SERIES[0] }], format: (value) => value.toFixed(value % 1 ? 1 : 0) })));

  const meals = pick((day) => day.mealAveragePercent);
  charts.push(hasAny(meals)
    ? chartWindow("Meals: average eaten", "% of each meal", chart({ days, series: [{ label: "Eaten", values: meals, color: SERIES[0] }], maximum: 100, format: (value) => `${Math.round(value)}%` }))
    : emptyChart("Meals: average eaten", "No meals with an amount eaten in this period."));

  const mood = pick((day) => day.moodAverage);
  charts.push(hasAny(mood)
    ? chartWindow("Mood", "daily average, 1 = very distressed, 5 = content", chart({ days, kind: "line", series: [{ label: "Mood", values: mood, color: SERIES[0] }], minimum: 1, maximum: 5, format: (value) => value.toFixed(1) }))
    : emptyChart("Mood", "No mood scores in this period."));

  const behaviors = pick((day) => day.behaviorsSeen.length);
  charts.push(chartWindow("Difficult behaviors", "behaviors ticked per day", chart({ days, series: [{ label: "Behaviors", values: behaviors, color: SERIES[1] }] })));

  const pain = pick((day) => day.painMaximum);
  if (hasAny(pain)) charts.push(chartWindow("Pain", "highest score each day (0 to 10)", chart({ days, kind: "line", series: [{ label: "Pain", values: pain, color: SERIES[1] }], maximum: 10 })));

  const sleep = pick((day) => day.sleepHours);
  if (hasAny(sleep)) charts.push(chartWindow("Sleep", "hours per day (night + naps)", chart({ days, series: [{ label: "Sleep", values: sleep, color: SERIES[0] }], format: (value) => value.toFixed(value % 1 ? 1 : 0) })));

  const systolic = pick((day) => day.vitals.systolic);
  const diastolic = pick((day) => day.vitals.diastolic);
  if (hasAny(systolic)) {
    const series = [{ label: "Top (systolic)", values: systolic, color: SERIES[0] }, { label: "Bottom (diastolic)", values: diastolic, color: SERIES[1] }];
    charts.push(chartWindow("Blood pressure", "mmHg, daily average", chart({ days, kind: "line", series, minimum: 40, maximum: niceMaximum(Math.max(...systolic.filter(Boolean), 140)) }), series));
  }
  const vitalCharts = [
    ["pulse", "Pulse", "beats per minute"],
    ["temperatureF", "Temperature", "°F", (value) => value.toFixed(1)],
    ["oxygen", "Oxygen (SpO₂)", "%"],
    ["glucose", "Blood sugar", "mg/dL"],
    ["weightLb", "Weight", "lb", (value) => value.toFixed(1)],
  ];
  for (const [key, title, unitLabel, format] of vitalCharts) {
    const values = pick((day) => day.vitals[key]);
    if (!hasAny(values)) continue;
    const present = values.filter((value) => value !== null);
    const low = Math.min(...present);
    const high = Math.max(...present);
    const padding = Math.max(1, (high - low) * 0.25);
    charts.push(chartWindow(title, unitLabel, chart({
      days, kind: "line", series: [{ label: title, values, color: SERIES[0] }],
      minimum: Math.floor(low - padding), maximum: Math.ceil(high + padding), format: format ?? ((value) => String(Math.round(value))),
    })));
  }

  for (const medication of context.medications.filter((item) => item.kind === "as_needed")) {
    const values = pick((day) => day.asNeededDoses[medication.id] ?? 0);
    if (!hasAny(values)) continue;
    charts.push(chartWindow(`As needed: ${medication.name}`, "doses per day",
      chart({ days, series: [{ label: medication.name, values, color: SERIES[2] }], goal: medication.maximum_doses_per_day ?? null })));
  }

  return h("div", {},
    h("div", { class: "toolbar" },
      h("span", {}, "Show the last"),
      h("div", { class: "choices" }, [7, 14, 30, 90].map((count) => h("button", {
        "aria-pressed": String(trendsState.days === count),
        onclick: () => { trendsState.days = count; context.reload(); },
      }, `${count} days`))),
      h("span", { class: "small muted" }, "Hover or tap a bar or point for its value."),
    ),
    h("div", { class: "chart-grid" }, charts),
  );
}

// ---- Shared hover tooltip for every element with data-tip.

let tooltip;
export function installChartTooltips() {
  tooltip = h("div", { class: "toast", style: { position: "fixed", pointerEvents: "none", zIndex: 70, padding: "3px 8px", display: "none" } });
  document.body.append(tooltip);
  const show = (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (!target) { tooltip.style.display = "none"; return; }
    tooltip.textContent = target.getAttribute("data-tip");
    tooltip.style.display = "block";
    const left = Math.min(event.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${event.clientY - 34}px`;
  };
  document.addEventListener("pointermove", show);
  document.addEventListener("pointerdown", show);
  document.addEventListener("scroll", () => { tooltip.style.display = "none"; }, true);
}
