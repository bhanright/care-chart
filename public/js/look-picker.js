// "Choose a look": offered once on each device, the first time someone signs in there.
// Choosing a card restyles the app behind the window right away, so people can try a few
// before deciding. The choice is per device, like the Look setting it shares.

import { LOOK_GROUPS, LOOKS, lookByKey, schemeFor } from "./looks.js";
import { choiceButtons, h, openDialog } from "./ui.js";

/** A small picture of a look: its desktop, a window on it and its accent color. */
function lookSwatch(look) {
  const [desktop, window, accent] = look.preview;
  return h("span", { class: "look-swatch", "aria-hidden": "true", style: { background: desktop } },
    h("span", { class: "look-swatch-window", style: { background: window } },
      h("span", { class: "look-swatch-bar", style: { background: accent } })));
}

export function openLookPicker(context) {
  const cards = new Map();
  let schemeHolder;

  const showSchemes = () => {
    const look = lookByKey(context.device.skin);
    schemeHolder.replaceChildren(look.schemes.length
      ? h("div", { class: "field" }, h("span", {}, `${look.label} colors`), choiceButtons({
        options: look.schemes.map((scheme) => ({ value: scheme.value, label: scheme.label })),
        value: schemeFor(look.key, context.device.schemes), label: `${look.label} colors`,
        onchange: (value) => { if (value) context.setDevice({ schemes: { ...context.device.schemes, [look.key]: value } }); },
      }))
      : "");
  };
  const choose = (look) => {
    context.setDevice({ skin: look.key });
    for (const [key, card] of cards) card.setAttribute("aria-pressed", String(key === look.key));
    showSchemes();
  };

  const picked = openDialog({
    title: "Choose a look",
    size: "wide",
    build: () => h("div", { class: "look-picker" },
      h("p", { style: { marginTop: 0 } },
        "Care Chart can look like a classic computer system or something more modern. Pick one to try it; ",
        "you can change it any time in Settings → This device. Each phone or computer keeps its own."),
      LOOK_GROUPS.map((group) => h("section", {},
        h("h3", {}, group.label),
        h("div", { class: "look-grid" }, LOOKS.filter((look) => look.group === group.key).map((look) => {
          const card = h("button", {
            type: "button", class: "look-card", "aria-pressed": String(context.device.skin === look.key),
            onclick: () => choose(look),
          }, lookSwatch(look), h("span", { class: "look-name" }, look.label));
          cards.set(look.key, card);
          return card;
        })),
      )),
      schemeHolder = h("div", { style: { marginTop: "10px" } }),
      h("div", { class: "field", style: { marginTop: "10px" } }, h("span", {}, "Light or dark"), choiceButtons({
        options: [{ value: "day", label: "Day (light)" }, { value: "night", label: "Night (dark)" }, { value: "auto", label: "Match this device" }],
        value: context.device.theme, label: "Light or dark",
        onchange: (value) => { if (value) context.setDevice({ theme: value }); },
      })),
    ),
    buttons: (close) => [h("button", { class: "default", onclick: () => close(true) }, "Done")],
  });
  showSchemes(); // openDialog builds the window before it returns
  return picked.finally(() => {
    // Closing the window in any way counts as choosing, so it is offered only once.
    context.setDevice({ lookChosen: true });
    context.rerender();
  });
}
