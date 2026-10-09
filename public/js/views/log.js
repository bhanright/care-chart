// The Log: everything charted on one day, filterable by type and searchable.

import { ENTRY_TYPES, ENTRY_TYPE_ORDER } from "../entry-types.js";
import { addDays, dateKey, formatDay, startOfDay } from "../time.js";
import { h, windowBox } from "../ui.js";
import { itemText, itemTypeKey, renderTimeline, timelineItems } from "./timeline.js";

/** The Log remembers its day, filters and search while the app is open. */
export const logState = {
  day: dateKey(new Date()),
  hiddenTypes: new Set(),
  search: "",
  showVoided: true,
};

export function logRange() {
  return { from: startOfDay(logState.day), to: startOfDay(addDays(logState.day, 1)) };
}

export function renderLog(context) {
  const today = dateKey(context.now());
  const allItems = timelineItems(context.data);
  // Doses are loaded by slot as well as by time; keep only those given on this day.
  const dayStart = startOfDay(logState.day);
  const dayEnd = startOfDay(addDays(logState.day, 1));
  const items = allItems.filter((item) => item.time >= dayStart && item.time < dayEnd);
  const search = logState.search.toLowerCase();
  const visible = items.filter((item) =>
    !logState.hiddenTypes.has(itemTypeKey(item))
    && (logState.showVoided || !item.record.voided_at)
    && (!search || itemText(item, context).toLowerCase().includes(search)));

  const goToDay = (day) => { logState.day = day; context.reload(); };
  const typeFilters = [{ key: "medication", label: "Medications" }, ...ENTRY_TYPE_ORDER.map((key) => ({ key, label: ENTRY_TYPES[key].label }))];
  const countFor = (key) => items.filter((item) => itemTypeKey(item) === key && !item.record.voided_at).length;

  const searchBox = h("input", {
    type: "search", placeholder: "Search this day…", value: logState.search, "aria-label": "Search this day",
    oninput: (event) => { logState.search = event.target.value; context.rerender({ keepFocus: "log-search" }); },
    id: "log-search",
  });

  return h("div", {},
    h("div", { class: "toolbar" },
      h("button", { class: "compact", onclick: () => goToDay(addDays(logState.day, -1)), "aria-label": "Previous day" }, "◀ Prev"),
      h("input", { type: "date", value: logState.day, max: today, "aria-label": "Day", onchange: (event) => event.target.value && goToDay(event.target.value) }),
      h("button", { class: "compact", disabled: logState.day >= today, onclick: () => goToDay(addDays(logState.day, 1)), "aria-label": "Next day" }, "Next ▶"),
      h("button", { class: "compact", disabled: logState.day === today, onclick: () => goToDay(today) }, "Today"),
      h("span", { class: "separator" }),
      searchBox,
      h("label", { class: "check small" },
        h("input", { type: "checkbox", checked: logState.showVoided, onchange: (event) => { logState.showVoided = event.target.checked; context.rerender(); } }),
        "Show entries in error"),
    ),
    h("div", { class: "filter-chips", style: { marginBottom: "10px" } },
      typeFilters.map((filter) => h("button", {
        "aria-pressed": String(!logState.hiddenTypes.has(filter.key)),
        onclick: () => {
          if (logState.hiddenTypes.has(filter.key)) logState.hiddenTypes.delete(filter.key);
          else logState.hiddenTypes.add(filter.key);
          context.rerender();
        },
      }, `${filter.label} (${countFor(filter.key)})`)),
      h("button", { class: "compact", onclick: () => { logState.hiddenTypes.clear(); context.rerender(); } }, "All"),
    ),
    windowBox({ title: formatDay(logState.day), extra: `${visible.length} of ${items.length} shown`, bodyClass: "flush" },
      h("div", { class: "well" }, renderTimeline(visible, context, { emptyText: items.length ? "Nothing matches the filters." : "Nothing charted on this day." }))),
  );
}
