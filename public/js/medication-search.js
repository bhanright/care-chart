// Suggestions for the Medication name field, from the list that ships with the app
// (public/data/medications.json, built by scripts/build-medication-list.mjs): the 1,000
// most prescribed medications in Medicare, plus WHO essential medicines, with brands,
// international names, strengths and forms.

import { h } from "./ui.js";

const MINIMUM_QUERY_LENGTH = 2;
const MAXIMUM_SUGGESTIONS = 8;
/**
 * Order among equal matches: by Medicare prescriptions; then over-the-counter remedies,
 * which Medicare rarely pays for; then WHO-only additions.
 */
const OVER_THE_COUNTER_PLACE = 50_000;
const UNRANKED_PLACE = 100_000;
const placeOf = (medication) => medication.rank ?? (medication.otc ? OVER_THE_COUNTER_PLACE : UNRANKED_PLACE);

let listPromise = null;

/** Loads the list once per page; later calls reuse it. */
export function loadMedicationList() {
  listPromise ??= fetch("/data/medications.json")
    .then((response) => {
      if (!response.ok) throw new Error(`medication list: ${response.status}`);
      return response.json();
    })
    .then(prepareMedicationList)
    .catch((error) => {
      listPromise = null; // try again next time the form opens
      throw error;
    });
  return listPromise;
}

/** Adds lowercase copies of every name for searching. Exported for scripts/check-medication-search.mjs. */
export function prepareMedicationList(file) {
  return file.medications.map((medication) => ({
    ...medication,
    searchName: medication.name.toLowerCase(),
    searchBrands: medication.brands.map((brand) => brand.toLowerCase()),
    searchAliases: medication.aliases.map((alias) => alias.toLowerCase()),
  }));
}

const startsAWord = (text, query) => text.startsWith(query) || text.includes(` ${query}`) || text.includes(`/${query}`);

/**
 * Ranks medications for what was typed. Lower scores first: the name starts with it,
 * then a brand, then another name (such as "paracetamol"), then any word in them.
 * Ties go to the more often prescribed medication.
 */
export function searchMedications(medications, typed) {
  const query = typed.trim().toLowerCase();
  if (query.length < MINIMUM_QUERY_LENGTH) return [];
  const results = [];
  for (const medication of medications) {
    let score = null;
    let matchedBrand = null;
    let matchedAlias = null;
    if (medication.searchName.startsWith(query)) score = 0;
    else {
      const brandIndex = medication.searchBrands.findIndex((brand) => brand.startsWith(query));
      const aliasIndex = medication.searchAliases.findIndex((alias) => alias.startsWith(query));
      if (brandIndex >= 0) { score = 1; matchedBrand = medication.brands[brandIndex]; }
      else if (aliasIndex >= 0) { score = 2; matchedAlias = medication.aliases[aliasIndex]; }
      else if (startsAWord(medication.searchName, query)) score = 3;
      else {
        const brandWord = medication.searchBrands.findIndex((brand) => startsAWord(brand, query));
        if (brandWord >= 0) { score = 4; matchedBrand = medication.brands[brandWord]; }
      }
    }
    if (score !== null) results.push({ medication, score, matchedBrand, matchedAlias });
  }
  return results
    .sort((a, b) => a.score - b.score || placeOf(a.medication) - placeOf(b.medication))
    .slice(0, MAXIMUM_SUGGESTIONS);
}

/** The route a dose form is given by, in the words the medication form uses. */
export function routeForForm(form) {
  const rules = [
    [/sublingual/i, "under the tongue"], [/ophthalmic/i, "eye drops"], [/otic/i, "ear drops"],
    [/nasal/i, "nasal spray"], [/inhal/i, "inhaled"], [/transdermal|patch/i, "on the skin (patch)"],
    [/topical|cream|ointment|gel|lotion|shampoo|foam/i, "applied to skin"], [/rectal|suppository|enema/i, "rectal"],
    [/vaginal/i, "vaginal"], [/inject|pen|syringe|cartridge/i, "injection"], [/oral|chewable|buccal/i, "by mouth"],
  ];
  return rules.find(([pattern]) => pattern.test(form))?.[1] ?? "";
}

/** A sensible "usual dose" hint for a dose form: "1 tablet", "1 puff". */
function doseHintForForm(form) {
  if (/tablet/i.test(form)) return "e.g. 1 tablet";
  if (/capsule/i.test(form)) return "e.g. 1 capsule";
  if (/inhal/i.test(form)) return "e.g. 2 puffs";
  if (/solution|suspension|syrup|elixir/i.test(form) && /oral/i.test(form)) return "e.g. 5 mL";
  if (/ophthalmic|otic/i.test(form)) return "e.g. 1 drop";
  if (/inject|pen/i.test(form)) return "e.g. 10 units";
  return "e.g. as directed";
}

let listboxCount = 0;

/**
 * Turns the medication name input into a search box. Choosing a suggestion fills the
 * name, offers that medication's strengths in the strength field, and sets the route
 * (unless the caregiver already changed it).
 */
export function attachMedicationSearch({ nameInput, strengthInput, doseInput, routeInput }) {
  const listboxId = `medication-suggestions-${++listboxCount}`;
  const strengthListId = `${listboxId}-strengths`;
  const listbox = h("ul", { class: "suggestions", id: listboxId, role: "listbox", hidden: true, "aria-label": "Matching medications" });
  const strengthList = h("datalist", { id: strengthListId });
  const note = h("div", { class: "small muted" }, "Type 2 or more letters of a generic or brand name.");
  let medications = [];
  let results = [];
  let activeIndex = -1;
  let chosen = null;
  let routeChangedByHand = false;

  nameInput.setAttribute("role", "combobox");
  nameInput.setAttribute("aria-autocomplete", "list");
  nameInput.setAttribute("aria-expanded", "false");
  nameInput.setAttribute("aria-controls", listboxId);
  nameInput.setAttribute("autocomplete", "off");
  strengthInput.setAttribute("list", strengthListId);
  routeInput.addEventListener("input", () => { routeChangedByHand = true; });

  const offerStrengths = (medication) => {
    strengthList.replaceChildren(...medication.strengths.map(([strength, form]) => h("option", { value: strength, label: form })));
  };

  loadMedicationList()
    .then((list) => {
      medications = list;
      // Editing a medication already on the list: offer its strengths without a new search.
      const typedName = nameInput.value.replace(/\s*\(.*\)$/, "").trim().toLowerCase();
      const known = typedName && list.find((medication) => medication.searchName === typedName);
      if (known) { chosen = known; offerStrengths(known); }
    })
    .catch(() => { note.textContent = "Suggestions are unavailable right now; type the name yourself."; });

  const close = () => {
    listbox.hidden = true;
    activeIndex = -1;
    nameInput.setAttribute("aria-expanded", "false");
    nameInput.removeAttribute("aria-activedescendant");
  };

  const highlight = (index) => {
    activeIndex = index;
    [...listbox.children].forEach((item, itemIndex) => item.setAttribute("aria-selected", String(itemIndex === index)));
    if (index >= 0) {
      nameInput.setAttribute("aria-activedescendant", `${listboxId}-${index}`);
      listbox.children[index].scrollIntoView({ block: "nearest" });
    } else {
      nameInput.removeAttribute("aria-activedescendant");
    }
  };

  const choose = (result) => {
    const medication = result.medication;
    chosen = medication;
    // Keep the brand the caregiver typed, since that is what the bottle says.
    nameInput.value = result.matchedBrand ? `${medication.name} (${result.matchedBrand})` : medication.name;
    offerStrengths(medication);
    const firstForm = medication.strengths[0]?.[1] ?? "";
    if (firstForm && !routeChangedByHand) routeInput.value = routeForForm(firstForm) || routeInput.value;
    if (firstForm && !doseInput.value) doseInput.placeholder = doseHintForForm(firstForm);
    note.textContent = medication.strengths.length
      ? `${medication.strengths.length} strengths known; pick one in the Strength field or type your own.`
      : "No strengths on file for this one; type the strength from the label.";
    close();
    nameInput.dispatchEvent(new Event("change"));
    strengthInput.focus();
  };

  // A strength picked from the list also says the form, and so the route.
  strengthInput.addEventListener("change", () => {
    const match = chosen?.strengths.find(([strength]) => strength === strengthInput.value.trim());
    if (match && !routeChangedByHand) routeInput.value = routeForForm(match[1]) || routeInput.value;
    if (match && !doseInput.value) doseInput.placeholder = doseHintForForm(match[1]);
  });

  const render = () => {
    results = searchMedications(medications, nameInput.value);
    listbox.replaceChildren(...results.map((result, index) => {
      const medication = result.medication;
      const otherNames = result.matchedBrand ? `Brand: ${result.matchedBrand}`
        : result.matchedAlias ? `Also called ${result.matchedAlias}`
          : medication.brands.length ? `Brands: ${medication.brands.slice(0, 3).join(", ")}` : "";
      return h("li", {
        id: `${listboxId}-${index}`,
        role: "option",
        "aria-selected": "false",
        // pointerdown, so the choice lands before the input loses focus
        onpointerdown: (event) => { event.preventDefault(); choose(result); },
      },
      h("div", { class: "suggestion-name" }, medication.name,
        medication.otc ? h("span", { class: "otc-badge", title: `Sold over the counter: ${medication.otc}` }, "OTC") : null,
        medication.who ? h("span", { class: "who-badge", title: `WHO essential medicine: ${medication.who}` }, "WHO") : null),
      h("div", { class: "small muted" }, [
        otherNames,
        medication.rank && medication.rank <= 1000 ? `#${medication.rank} most prescribed` : null,
        medication.otc && !medication.rank ? medication.otc : null,
      ].filter(Boolean).join(" · ")),
      );
    }));
    const open = results.length > 0;
    listbox.hidden = !open;
    nameInput.setAttribute("aria-expanded", String(open));
    highlight(open ? 0 : -1);
  };

  nameInput.addEventListener("input", () => { chosen = null; render(); });
  nameInput.addEventListener("focus", () => { if (nameInput.value.trim().length >= MINIMUM_QUERY_LENGTH && !chosen) render(); });
  nameInput.addEventListener("blur", () => setTimeout(close, 0));
  nameInput.addEventListener("keydown", (event) => {
    if (listbox.hidden) {
      if (event.key === "ArrowDown" && nameInput.value.trim().length >= MINIMUM_QUERY_LENGTH) { render(); event.preventDefault(); }
      return;
    }
    if (event.key === "ArrowDown") { highlight(Math.min(activeIndex + 1, results.length - 1)); event.preventDefault(); }
    else if (event.key === "ArrowUp") { highlight(Math.max(activeIndex - 1, 0)); event.preventDefault(); }
    else if (event.key === "Enter" && activeIndex >= 0) { choose(results[activeIndex]); event.preventDefault(); }
    else if (event.key === "Escape") { close(); event.stopPropagation(); event.preventDefault(); }
    else if (event.key === "Tab") close();
  });

  return {
    /** Goes under the name input, inside the same field wrapper. */
    elements: [
      h("div", { class: "suggestions-anchor" }, listbox), strengthList, note,
      // The WHO list's license (CC BY-NC-SA 3.0 IGO) and NLM's terms ask for this credit.
      h("div", { class: "small muted" }, "Suggestions: Medicare Part D (CMS), common over-the-counter remedies, WHO Model List of Essential Medicines 2025 (CC BY-NC-SA 3.0 IGO), RxNorm (U.S. National Library of Medicine)."),
    ],
  };
}
