// DOM helpers: an element builder, Win95-style windows and dialogs, and toasts.

/**
 * Builds an element. `h("button", { class: "compact", onclick }, "Give")`.
 * Attributes starting with "on" become event listeners; false/null attributes are skipped;
 * children may be strings, numbers, elements, arrays or null.
 */
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2), value);
    else if (name === "style" && typeof value === "object") {
      // setProperty also handles custom properties such as "--swatch".
      for (const [property, propertyValue] of Object.entries(value)) {
        if (property.startsWith("--")) element.style.setProperty(property, propertyValue);
        else element.style[property] = propertyValue;
      }
    }
    else if (name === "dataset") Object.assign(element.dataset, value);
    else if (name in element && typeof value !== "string") element[name] = value;
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** A raised window with a navy title bar. */
export function windowBox({ title, icon = null, extra = null, bodyClass = "", buttons = [], className = "" }, ...body) {
  return h("section", { class: `window ${className}` },
    h("div", { class: "title-bar" },
      icon,
      h("span", { class: "title" }, title),
      extra ? h("span", { class: "title-extra" }, extra) : null,
      buttons,
    ),
    h("div", { class: `window-body ${bodyClass}` }, body),
  );
}

// ---- Small icons drawn in the 16-color spirit.

export function chartIcon(size = 16) {
  return svgIcon(size, `
    <rect x="2" y="1" width="12" height="14" fill="#fff" stroke="#000"/>
    <rect x="5" y="0" width="6" height="3" fill="#c0c0c0" stroke="#000"/>
    <path d="M4 9h2l1-3 2 6 1-3h2" fill="none" stroke="#c00000" stroke-width="1.4"/>`);
}
export function warningIcon(size = 34) {
  return svgIcon(size, `<path d="M8 1 15 14H1Z" fill="#ffd800" stroke="#000"/><rect x="7.2" y="5" width="1.6" height="5" fill="#000"/><rect x="7.2" y="11" width="1.6" height="1.6" fill="#000"/>`);
}
export function questionIcon(size = 34) {
  return svgIcon(size, `<circle cx="8" cy="8" r="7" fill="#fff" stroke="#000080" stroke-width="1.2"/><text x="8" y="12" font-size="10" font-weight="bold" text-anchor="middle" fill="#000080" font-family="Tahoma">?</text>`);
}
export function errorIcon(size = 34) {
  return svgIcon(size, `<circle cx="8" cy="8" r="7" fill="#d00000" stroke="#000"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="2"/>`);
}
function svgIcon(size, inner) {
  const wrapper = document.createElement("span");
  wrapper.innerHTML = `<svg class="title-icon" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">${inner}</svg>`;
  const svg = wrapper.firstElementChild;
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;
  return svg;
}

// ---- Dialogs

let openDialogs = 0;

/**
 * Opens a modal window. `build(close)` returns the body; `buttons(close)` returns the
 * button row. Returns a promise for the value passed to close(). Escape closes with null.
 */
/**
 * Disables every field and button inside a container (or hides the buttons), for
 * caregivers who may look but not change it.
 */
export function lockControls(container, { hideButtons = false } = {}) {
  for (const element of container.querySelectorAll("input, select, textarea, button")) {
    if (hideButtons && element.tagName === "BUTTON") element.hidden = true;
    else element.disabled = true;
  }
  return container;
}

/**
 * A dialog. With readOnly, every field is locked and the only button is Close, for
 * caregivers whose access lets them read the record but not change it.
 */
export function openDialog({ title, size = "", build, buttons, icon = chartIcon(), readOnly = false }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    let layer;
    let closed = false;
    // Safe to call more than once (Escape while a save is finishing, then the save).
    const close = (value = null) => {
      if (closed) return;
      closed = true;
      layer.remove();
      openDialogs--;
      document.body.classList.toggle("dialog-open", openDialogs > 0);
      document.removeEventListener("keydown", onKey, true);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (event) => {
      if (layer !== document.querySelector(".dialog-layer:last-of-type")) return;
      // An open suggestion list takes Escape for itself.
      if (event.key === "Escape" && event.target?.getAttribute?.("aria-expanded") === "true") return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close(null);
      } else if (event.key === "Tab") {
        // Keep keyboard focus inside the open window.
        const focusable = [...layer.querySelectorAll("button, input, select, textarea, a[href], summary")]
          .filter((element) => !element.disabled && !element.hidden && element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
        else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
      }
    };
    const body = build(close);
    if (readOnly) {
      lockControls(body);
      buttons = (closeDialog) => [
        h("span", { class: "left small muted" }, "View only: your access does not allow changes here."),
        h("button", { class: "default", onclick: () => closeDialog(null) }, "Close"),
      ];
    }
    const dialog = h("div", { class: `window dialog ${size}`, role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "title-bar" },
        icon,
        h("span", { class: "title" }, title),
        h("button", { class: "title-button", "aria-label": "Close", onclick: () => close(null) }, "✕"),
      ),
      h("div", { class: "window-body" }, body),
      buttons ? h("div", { class: "dialog-buttons" }, buttons(close)) : null,
    );
    layer = h("div", { class: "dialog-layer", onmousedown: (event) => { if (event.target === layer) close(null); } }, dialog);
    document.body.append(layer);
    openDialogs++;
    document.body.classList.add("dialog-open");
    document.addEventListener("keydown", onKey, true);
    const firstField = dialog.querySelector("[autofocus], .window-body input:not([type=checkbox]), .window-body select, .window-body textarea, .dialog-buttons button.default");
    (firstField ?? dialog.querySelector("button"))?.focus({ preventScroll: true });
  });
}

export function isDialogOpen() {
  return openDialogs > 0;
}

/** A Win95 message box. Resolves true for the confirm button, false otherwise. */
export function confirmBox({ title = "Care Chart", message, detail = null, confirmText = "OK", cancelText = "Cancel", kind = "question" }) {
  const icon = kind === "warning" ? warningIcon() : kind === "error" ? errorIcon() : questionIcon();
  return openDialog({
    title,
    size: "narrow",
    icon: chartIcon(),
    build: () => h("div", { class: "row", style: { alignItems: "flex-start", flexWrap: "nowrap" } },
      icon,
      h("div", {}, h("p", { style: { marginTop: 0 } }, message), detail),
    ),
    buttons: (close) => [
      h("button", { class: "default", onclick: () => close(true) }, confirmText),
      cancelText ? h("button", { onclick: () => close(false) }, cancelText) : null,
    ],
  }).then((value) => value === true);
}

/** Asks for one line of text. Resolves the text, or null if canceled. */
export function promptBox({ title, message, label, placeholder = "", required = false, confirmText = "OK" }) {
  let input;
  let error;
  return openDialog({
    title,
    size: "narrow",
    build: (close) => h("form", {
      onsubmit: (event) => {
        event.preventDefault();
        if (required && !input.value.trim()) { error.textContent = "Please fill this in."; return; }
        close(input.value.trim());
      },
    },
      message ? h("p", { style: { marginTop: 0 } }, message) : null,
      h("label", { class: "field" }, h("span", {}, label), input = h("input", { placeholder, autofocus: true })),
      error = h("p", { class: "error-text small" }),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      h("button", { class: "default", onclick: () => input.form.requestSubmit() }, confirmText),
      h("button", { onclick: () => close(null) }, "Cancel"),
    ],
  });
}

// ---- Guarding saves

/**
 * Wraps an async save so a double tap runs it once. While it runs, `button` (or the
 * default button of the topmost dialog) is disabled.
 */
export function guardSave(save, button = null) {
  let running = false;
  return async (...args) => {
    if (running) return;
    running = true;
    const target = button ?? document.querySelector(".dialog-layer:last-of-type .dialog-buttons .default");
    if (target) target.disabled = true;
    try {
      return await save(...args);
    } finally {
      running = false;
      if (target) target.disabled = false;
    }
  };
}

// ---- Toasts

let toastShelf;

/** Shows a short message. `action` = { label, run } adds a button such as Undo. */
export function toast(message, { action = null, error = false, seconds = 6 } = {}) {
  toastShelf ??= document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  const item = h("div", { class: `toast ${error ? "error" : ""}` }, h("span", { class: "spacer" }, message));
  if (action) item.append(h("button", { onclick: () => { item.remove(); action.run(); } }, action.label));
  item.append(h("button", { "aria-label": "Dismiss", onclick: () => item.remove() }, "✕"));
  toastShelf.append(item);
  setTimeout(() => item.remove(), seconds * 1000);
}

// ---- Form helpers

/** A labeled field wrapper. */
export function field(label, control, extraClass = "") {
  return h("label", { class: `field ${extraClass}` }, h("span", {}, label), control);
}

/**
 * Segmented toggle buttons. `options` are { value, label, hint? }. In multiple mode the
 * value is an array. Calls onchange(value) on every change.
 */
export function choiceButtons({ options, value, multiple = false, scale = false, onchange = () => {}, label = "" }) {
  let current = multiple ? [...(value ?? [])] : value ?? null;
  const hint = h("div", { class: "choice-hint" });
  const group = h("div", { class: `choices ${scale ? "scale" : ""}`, role: "group", "aria-label": label });
  const buttons = options.map((option) => {
    const button = h("button", {
      type: "button",
      title: option.hint ?? "",
      onclick: () => {
        if (multiple) {
          current = current.includes(option.value) ? current.filter((item) => item !== option.value) : [...current, option.value];
        } else {
          current = current === option.value ? null : option.value;
        }
        refresh();
        onchange(current);
      },
    }, option.label);
    group.append(button);
    return { button, option };
  });
  function refresh() {
    for (const { button, option } of buttons) {
      const pressed = multiple ? current.includes(option.value) : current === option.value;
      button.setAttribute("aria-pressed", String(pressed));
    }
    const selected = options.find((option) => option.value === current);
    hint.textContent = !multiple && selected?.hint ? selected.hint : "";
  }
  refresh();
  const wrapper = h("div", {}, group, options.some((option) => option.hint) && !multiple ? hint : null);
  wrapper.getValue = () => current;
  return wrapper;
}

/** Win95 progress bar; fraction 0..1 (values over 1 show full in green). */
export function progressBar(fraction, label = "") {
  const clamped = Math.max(0, Math.min(1, fraction));
  return h("div", { class: `progress ${fraction >= 1 ? "over" : ""}`, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(clamped * 100)), "aria-label": label },
    h("div", { style: { width: `${clamped * 100}%` } }));
}

export function clear(element) {
  while (element.firstChild) element.firstChild.remove();
}
