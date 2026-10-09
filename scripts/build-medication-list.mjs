// Builds public/data/medications.json: the 1,000 most commonly prescribed medications,
// cross-referenced with the WHO Model List of Essential Medicines, with brand names and
// the strengths and forms each comes in. The app ships this file and searches it as the
// caregiver types a medication name (public/js/medication-search.js).
//
// Sources:
//   - Prescription counts: CMS "Medicare Part D Prescribers - by Geography and Drug",
//     national rows (total claims per brand and generic name). Medicare covers mostly
//     people over 65, which suits this app. U.S. government work, public domain.
//   - Essential medicines: WHO Model List of Essential Medicines (24th list, 2025, and
//     the children's list), from scripts/data/who-essential-medicines.csv (made by
//     scripts/extract_who_eml.py). (c) World Health Organization, CC BY-NC-SA 3.0 IGO.
//     Each listed medicine is flagged and its international name (paracetamol,
//     salbutamol) becomes a search term. Listed medicines outside the top 1,000 are
//     added when they are sold in the U.S. in a form given at home (RxNorm has a
//     non-injectable form), which leaves out vaccines, blood products, dental
//     materials and hospital-only injections.
//   - Over-the-counter remedies families keep at home (pain relievers, laxatives,
//     antacids, allergy and sleep aids, creams, vitamins), hand-picked in
//     scripts/data/over-the-counter.csv with the store brands people ask for by name.
//     Medicare Part D rarely pays for these, so they are missing from the CMS counts.
//   - Strengths, forms and clean ingredient names: RxNorm from the U.S. National Library
//     of Medicine (RxNav API). "This product uses publicly available data from the U.S.
//     National Library of Medicine (NLM), National Institutes of Health, Department of
//     Health and Human Services; NLM is not responsible for the product and does not
//     endorse or recommend this or any other product."
//
// Run from the CareChart folder:  npm run build:medications
// RxNav answers are cached in .cache/rxnorm/, so a rerun takes seconds.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CMS_DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/c8ea3f8e-3a09-4fea-86f2-8902fb4b0920/data";
const RXNAV_URL = "https://rxnav.nlm.nih.gov/REST/drugs.json";
const MEDICATION_COUNT = 1000;
const MAXIMUM_STRENGTHS_PER_MEDICATION = 16;
const MAXIMUM_BRANDS_PER_MEDICATION = 6;
const RXNAV_PAUSE_MS = 70; // RxNav asks for at most 20 requests a second
/** A cut-off word still identifies an ingredient if this many letters agree. */
const SHORTEST_USEFUL_PREFIX = 5;
const CACHE_FOLDER = ".cache/rxnorm";
const OUTPUT_FILE = "public/data/medications.json";
const WHO_LIST_FILE = "scripts/data/who-essential-medicines.csv";
const OVER_THE_COUNTER_FILE = "scripts/data/over-the-counter.csv";

/** CMS rows that are supplies or vaccines, not medicines given at home. */
const NOT_A_HOME_MEDICINE = /needle|syringe|lancet|test strip|diagnostic|device|supplies|alcohol pad|swab|glucose monitor|sensor|insulin pump|ostomy|catheter|bandage|dressing|nebulizer|spacer|meter|vaccin|\bvacc?\b|antigen|toxoid|as01|antiseptic pads/i;
/** WHO entries that are groups or vaccines rather than one medicine. */
const WHO_NOT_A_MEDICINE = /^medicines for |vaccine|immunoglobulin|antivenom|antitoxin|antiserum|\bsera\b/i;
/** WHO medicines sold in a non-injectable form that still are not given at home. */
const WHO_CLINIC_ONLY = /isoflurane|sevoflurane|halothane|nitrous oxide|glutaral|beractant|poractant|carbachol/i;

/** Salt and qualifier words that follow the ingredient's own name ("Metoprolol Succinate"). */
const SALT_WORDS = new Set([
  "hydrochloride", "sodium", "potassium", "calcium", "magnesium", "besylate", "succinate", "tartrate", "sulfate",
  "maleate", "maleat", "mesylate", "citrate", "acetate", "fumarate", "bromide", "hyclate", "monohydrate", "monohyd",
  "dipropionate", "propionate", "furoate", "phosphate", "hydrobromide", "hbr", "bitartrate", "malate", "tosylate",
  "dihydrate", "er", "pf", "base", "disodium", "dimesylate", "trihydrate", "lactate", "gluconate", "carbonate",
  "medoxomil", "axetil", "pivoxil", "valerate", "decanoate", "palmitate", "estolate", "mononitrate", "dinitrate",
  "bisulfate", "oxalate", "propanediol", "etexilate", "xinafoate", "trifenatate", "hemifumarate", "olamine",
  "monosodium", "anhydrous", "hcl", "benzoate", "br", "brm", "tr", "di", "usp", "nanocrystallized", "micronized",
  "extended", "macrocrystal", "macrocrystals", "hfa", "dihydrochloride",
]);

/**
 * For minerals the "salt" word is the medicine itself: calcium carbonate (Tums) and
 * calcium acetate (a prescription phosphate binder) must never be treated as the same.
 */
const MINERAL_FIRST_WORDS = new Set(["calcium", "potassium", "sodium", "magnesium", "zinc", "ferrous", "ferric", "aluminum", "lithium"]);

/** Abbreviations CMS uses in its shortened names. */
const CMS_ABBREVIATIONS = [["hcthiazid", "hydrochlorothiazide"], ["hctz", "hydrochlorothiazide"], ["sod", "sodium"]];

/**
 * International (WHO) spellings and their U.S. names, so "paracetamol" finds
 * acetaminophen. Applied to whole words or phrases when names are compared.
 */
const INTERNATIONAL_TO_US_NAMES = [
  ["acetylsalicylic acid", "aspirin"], ["paracetamol", "acetaminophen"], ["salbutamol", "albuterol"],
  ["glyceryl trinitrate", "nitroglycerin"], ["colecalciferol", "cholecalciferol"], ["ciclosporin", "cyclosporine"],
  ["rifampicin", "rifampin"], ["noradrenaline", "norepinephrine"], ["adrenaline", "epinephrine"],
  ["pethidine", "meperidine"], ["benzylpenicillin", "penicillin g"], ["phenoxymethylpenicillin", "penicillin v"],
  ["ethinylestradiol", "ethinyl estradiol"], ["isoprenaline", "isoproterenol"], ["lignocaine", "lidocaine"],
  ["dexamfetamine", "dextroamphetamine"], ["mesalazine", "mesalamine"], ["glibenclamide", "glyburide"],
  ["hyoscine", "scopolamine"], ["sodium valproate", "valproic acid"], ["chlortalidone", "chlorthalidone"],
  ["cefalexin", "cephalexin"], ["aciclovir", "acyclovir"], ["indometacin", "indomethacin"], ["torasemide", "torsemide"],
  ["norethisterone", "norethindrone"], ["phytomenadione", "phytonadione"], ["leuprorelin", "leuprolide"],
  ["clomifene", "clomiphene"], ["ergometrine", "ergonovine"], ["methylthioninium chloride", "methylene blue"],
  ["hydroxycarbamide", "hydroxyurea"], ["tioguanine", "thioguanine"], ["suxamethonium", "succinylcholine"],
  ["sodium hydrogen carbonate", "sodium bicarbonate"], ["glycerol", "glycerin"], ["retinol", "vitamin a"],
  ["amoxicillin clavulanic acid", "amoxicillin clavulanate"], ["potassium clav", "clavulanate"],
  ["clavulanic acid", "clavulanate"], ["levothyroxine sodium", "levothyroxine"], ["alendronic acid", "alendronate"],
  ["zoledronic acid", "zoledronate"], ["ibandronic acid", "ibandronate"], ["risedronic acid", "risedronate"],
  ["tranexamic acid", "tranexamic acid"], ["divalproex", "valproic acid"], ["valproate", "valproic acid"],
];
/** CMS name fragments that are not ingredients ("/M-Cryst", ",hum.Rec.Anlog", "(Vitamin D2)"). */
const CMS_NAME_FRAGMENTS = [/\/m-cryst$/i, /,\s*hum\b.*$/i, /\([^)]*\)/g];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const capitalize = (text) => text.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());

// ---- Names

/** Lowercase words, without punctuation or parentheses. "Metformin Hcl" → ["metformin", "hcl"]. */
function rawWords(text) {
  return text.toLowerCase().replace(/[()]/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

/** Words for comparing names across sources: U.S. names, salts dropped (the first word always stays). */
function comparableName(text) {
  let lower = rawWords(text).join(" ");
  for (const [international, american] of [...CMS_ABBREVIATIONS, ...INTERNATIONAL_TO_US_NAMES]) {
    lower = lower.replace(new RegExp(`\\b${international}\\b`, "g"), american);
  }
  const words = lower.split(" ");
  if (MINERAL_FIRST_WORDS.has(words[0])) return words.filter((word) => word !== "usp").join(" ");
  return [words[0], ...words.slice(1).filter((word) => !SALT_WORDS.has(word))].join(" ");
}

/**
 * Splits a combination into ingredient names: "A/B", "A + B", "A With B", RxNorm's
 * "A / B", and CMS's "Levonorgestrel-Ethinyl Estrad" (a hyphen between two long words).
 */
function ingredientsOf(generic) {
  let cleaned = generic;
  for (const fragment of CMS_NAME_FRAGMENTS) cleaned = cleaned.replace(fragment, "");
  return cleaned
    .split(/\s*\/\s*|\s+\+\s+|\s+with\s+|(?<=[a-z]{5})-(?=[a-z]{5})/i)
    .map((part) => part.trim()).filter(Boolean);
}

/**
 * True if two ingredient names agree. With allowCutOff, each word may be cut short, as
 * CMS does ("tenofov ala" = "tenofovir alafenamide", "umeclidin" = "umeclidinium").
 */
function sameIngredient(a, b, allowCutOff) {
  if (a === b) return true;
  if (!allowCutOff) return false;
  const wordsA = a.split(" ");
  const wordsB = b.split(" ");
  if (wordsA.length !== wordsB.length) return false;
  return wordsA.every((word, index) => {
    const other = wordsB[index];
    const [shorter, longer] = word.length < other.length ? [word, other] : [other, word];
    const shortest = index === 0 ? SHORTEST_USEFUL_PREFIX : 3;
    return shorter === longer || (shorter.length >= shortest && longer.startsWith(shorter));
  });
}

/** True if two lists name the same ingredients (in any order). */
function sameIngredients(a, b, allowCutOff = false) {
  if (a.length !== b.length) return false;
  const remaining = [...b];
  for (const name of a) {
    const index = remaining.findIndex((other) => sameIngredient(name, other, allowCutOff));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/** The CMS medication with the same ingredients as a WHO entry, allowing CMS's shortened names. */
function findPrescribed(allPrescribed, name) {
  const wanted = ingredientsOf(name).map(comparableName);
  return allPrescribed.find((medication) => sameIngredients(ingredientsOf(medication.generic).map(comparableName), wanted, true)) ?? null;
}

// ---- WHO list

/** Reads scripts/data/who-essential-medicines.csv (quoted fields may contain commas). */
function readWhoList() {
  const lines = readFileSync(WHO_LIST_FILE, "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const cells = [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((match) => match[1].replace(/^"|"$/g, "").replace(/""/g, '"'));
    return { name: cells[0], section: cells[1] };
  }).filter((row) => row.name);
}

// ---- Over-the-counter list

/** Reads scripts/data/over-the-counter.csv: name, brands separated by semicolons, group. */
function readOverTheCounterList() {
  const lines = readFileSync(OVER_THE_COUNTER_FILE, "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const [name, brands, group] = line.split(",");
    return { name: name.trim(), brands: brands.split(";").map((brand) => brand.trim()).filter(Boolean), group: group.trim() };
  });
}

// ---- CMS prescription counts

async function readPrescriptionCounts() {
  const response = await fetch(`${CMS_DATASET_URL}?size=5000&filter[Prscrbr_Geo_Lvl]=National`);
  if (!response.ok) throw new Error(`CMS download failed: ${response.status}`);
  const rows = await response.json();
  const byGeneric = new Map();
  for (const row of rows) {
    const generic = row.Gnrc_Name?.trim();
    if (!generic || NOT_A_HOME_MEDICINE.test(generic)) continue;
    const claims = Number(row.Tot_Clms) || 0;
    const record = byGeneric.get(generic) ?? { generic, claims: 0, brands: new Map(), aliases: new Set() };
    record.claims += claims;
    const brand = row.Brnd_Name?.trim();
    // Labels such as "Albuterol Sulfate Hfa" are the generic, not a brand.
    const firstGenericWord = rawWords(generic)[0];
    if (brand && rawWords(brand)[0] !== firstGenericWord && !NOT_A_HOME_MEDICINE.test(brand)) {
      record.brands.set(brand, (record.brands.get(brand) ?? 0) + claims);
    }
    byGeneric.set(generic, record);
  }
  console.log(`CMS: ${rows.length} national rows, ${byGeneric.size} medications after removing supplies and vaccines.`);
  return [...byGeneric.values()].sort((a, b) => b.claims - a.claims);
}

// ---- RxNorm strengths, forms and ingredient names

async function rxnavClinicalDrugs(searchName) {
  mkdirSync(CACHE_FOLDER, { recursive: true });
  const cacheFile = `${CACHE_FOLDER}/${createHash("sha1").update(searchName).digest("hex")}.json`;
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
  await wait(RXNAV_PAUSE_MS);
  const response = await fetch(`${RXNAV_URL}?name=${encodeURIComponent(searchName)}`);
  if (!response.ok) throw new Error(`RxNav failed for ${searchName}: ${response.status}`);
  const data = await response.json();
  const names = (data.drugGroup?.conceptGroup ?? [])
    .filter((group) => group.tty === "SCD")
    .flatMap((group) => group.conceptProperties ?? [])
    .map((concept) => concept.name);
  writeFileSync(cacheFile, JSON.stringify(names));
  return names;
}

const UNIT_WORDS = { MG: "mg", MCG: "mcg", UNT: "units", ML: "mL", MEQ: "mEq", ACTUAT: "actuation", HR: "hr", GM: "g" };
const tidyUnit = (unit) => unit.split("/").map((part) => UNIT_WORDS[part] ?? part.toLowerCase()).join("/");

/**
 * Reads an RxNorm clinical drug name such as
 * "amlodipine 5 MG / olmesartan medoxomil 20 MG Oral Tablet" into its ingredients,
 * strength text ("5 mg / 20 mg") and dose form ("Oral Tablet").
 */
function parseClinicalDrug(name) {
  // Some names start with a package size: "24 HR mirabegron 25 MG ...", "0.5 ML dulaglutide 1.5 MG/ML Auto-Injector".
  const packageMatch = /^([\d.]+) (HR|ML|ACTUAT|DAY|WEEK) (.+)$/.exec(name);
  if (packageMatch) {
    const inner = parseClinicalDrug(packageMatch[3]);
    if (!inner) return null;
    const [amount, unit] = [Number(packageMatch[1]), packageMatch[2]];
    if (unit === "HR") return { ...inner, form: `${amount} hr ${inner.form}` };
    if (unit === "ML") {
      // A pen or syringe: show what one holds, "0.75 mg in 0.5 mL", not "1.5 mg/mL".
      const perMilliliter = /^([\d.]+) (\S+)\/mL$/.exec(inner.strength);
      if (perMilliliter) return { ...inner, strength: `${+(Number(perMilliliter[1]) * amount).toFixed(4)} ${perMilliliter[2]} in ${amount} mL` };
    }
    return inner;
  }
  const parts = name.split(" / ");
  const ingredients = [];
  const strengths = [];
  let form = "";
  for (const [index, part] of parts.entries()) {
    const match = /^(.+?) ([\d.,]+) ([A-Z%]+(?:\/[A-Z]+)*)(?: (.+))?$/.exec(part);
    if (!match) return null;
    ingredients.push(match[1]);
    strengths.push(`${match[2]} ${tidyUnit(match[3])}`);
    if (index === parts.length - 1) form = match[4] ?? "";
  }
  return { ingredients, strength: strengths.join(" / "), form };
}

/** Forms a family gives at home come first in the strength list; injections last. */
function homeFormOrder(form) {
  if (/oral|chewable|sublingual|buccal/i.test(form)) return 0;
  if (/inhal|nasal|ophthalmic|otic|topical|transdermal|cream|ointment|gel|lotion|rectal|vaginal|shampoo|patch|spray/i.test(form)) return 1;
  if (/pen injector|prefilled|auto-injector|cartridge/i.test(form)) return 2;
  return 3;
}
const modifiedRelease = (form) => (/extended|delayed|hr /i.test(form) ? 1 : 0);
const isInjection = (form) => /inject|infusion|intravenous|irrigation|implant/i.test(form);

/**
 * Finds the RxNorm clinical drugs with exactly this medication's ingredients. Tries the
 * ingredient name without its salt, then with it, then the first word alone.
 */
async function clinicalDrugsFor(generic) {
  const components = ingredientsOf(generic);
  const wanted = components.map(comparableName);
  const wantedExact = components.map((part) => rawWords(part).join(" "));
  const firstWords = rawWords(components[0]);
  const searchNames = [...new Set([
    [firstWords[0], ...firstWords.slice(1).filter((word) => !SALT_WORDS.has(word))].join(" "),
    firstWords.slice(0, 2).join(" "),
    firstWords.join(" "),
    firstWords[0],
  ])];
  for (const searchName of searchNames) {
    const parsed = (await rxnavClinicalDrugs(searchName)).map(parseClinicalDrug).filter(Boolean);
    // Prefer an exact salt match (metoprolol succinate, not tartrate); otherwise the ingredient.
    const exact = parsed.filter((drug) => sameIngredients(drug.ingredients, wantedExact));
    if (exact.length) return exact;
    const byIngredient = parsed.filter((drug) => sameIngredients(drug.ingredients.map(comparableName), wanted, true));
    if (byIngredient.length) return byIngredient;
  }
  return [];
}

function strengthList(drugs) {
  const leadingNumber = (text) => Number.parseFloat(text.replace(/,/g, "")) || 0;
  const seen = new Set();
  return drugs
    // Home forms first, plain before extended or delayed release, then by strength.
    .sort((a, b) => homeFormOrder(a.form) - homeFormOrder(b.form) || modifiedRelease(a.form) - modifiedRelease(b.form)
      || a.form.localeCompare(b.form) || leadingNumber(a.strength) - leadingNumber(b.strength))
    .filter((drug) => {
      const key = `${drug.strength}|${drug.form}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAXIMUM_STRENGTHS_PER_MEDICATION)
    .map((drug) => [drug.strength, drug.form]);
}

/** RxNorm's ingredient names, in the CMS name's order: "Hydrochlorothiazide / Triamterene". */
function displayName(generic, drugs) {
  if (!drugs.length) return generic.replace(/\bHcl\b/g, "HCl").replace(/\bHbr\b/g, "HBr");
  const ingredients = drugs[0].ingredients;
  const order = ingredientsOf(generic).map(comparableName);
  const ranked = [...ingredients].sort((a, b) => {
    const position = (name) => order.findIndex((wanted) => sameIngredient(comparableName(name), wanted, true));
    return position(a) - position(b);
  });
  return capitalize(ranked.join(" / ").replace(/,?\s*USP/gi, ""));
}

// ---- Cross-reference with the WHO list

const allPrescribed = await readPrescriptionCounts();
allPrescribed.forEach((medication, index) => { medication.rank = index + 1; });
const chosen = allPrescribed.slice(0, MEDICATION_COUNT);

const whoCounts = { inTop: 0, fromLowerInMedicare: 0, fromWhoAlone: 0, groupsAndVaccines: 0, notGivenAtHome: 0 };
const whoOnlyCandidates = [];
for (const essential of readWhoList()) {
  if (WHO_NOT_A_MEDICINE.test(essential.name)) { whoCounts.groupsAndVaccines++; continue; }
  // allPrescribed is sorted by prescriptions, so the most prescribed salt wins.
  const match = findPrescribed(allPrescribed, essential.name);
  if (match) {
    match.whoSection ??= essential.section;
    match.aliases.add(essential.name);
    if (match.rank <= MEDICATION_COUNT) whoCounts.inTop++;
    else if (!chosen.includes(match)) { chosen.push(match); whoCounts.fromLowerInMedicare++; }
  } else {
    const usName = capitalize(ingredientsOf(essential.name).map(comparableName).join(" / "));
    whoOnlyCandidates.push({ generic: usName, claims: 0, rank: null, brands: new Map(), aliases: new Set([essential.name]), whoSection: essential.section });
  }
}

// ---- Over-the-counter remedies: flag and add brands where already listed, otherwise add.

const overTheCounterCounts = { alreadyListed: 0, addedFromMedicare: 0, added: 0 };
for (const remedy of readOverTheCounterList()) {
  const wanted = ingredientsOf(remedy.name).map(comparableName);
  const exactName = (text) => ingredientsOf(text).map((part) => rawWords(part).join(" ")).sort().join("|");
  // Salts are ignored when matching, except between two remedies on this list, so
  // calcium citrate + D (Citracal) does not merge into calcium carbonate + D (Caltrate).
  const sameAsRemedy = (medication) => sameIngredients(ingredientsOf(medication.generic).map(comparableName), wanted, true)
    && (!medication.overTheCounter || exactName(medication.generic) === exactName(remedy.name));
  let medication = chosen.find(sameAsRemedy) ?? whoOnlyCandidates.find(sameAsRemedy);
  if (medication) overTheCounterCounts.alreadyListed++;
  else {
    medication = findPrescribed(allPrescribed, remedy.name);
    if (medication) { chosen.push(medication); overTheCounterCounts.addedFromMedicare++; }
    else {
      medication = { generic: capitalize(remedy.name), claims: 0, rank: null, brands: new Map(), aliases: new Set() };
      chosen.push(medication);
      overTheCounterCounts.added++;
    }
  }
  medication.overTheCounter = remedy.group;
  // Store brands go first: they are what is on the box in the cupboard.
  const brands = new Map(remedy.brands.map((brand) => [brand, Number.MAX_SAFE_INTEGER]));
  for (const [brand, claims] of medication.brands) if (!brands.has(brand)) brands.set(brand, claims);
  medication.brands = brands;
}
console.log(`Over the counter: ${overTheCounterCounts.alreadyListed} already listed (flagged, brands added), `
  + `${overTheCounterCounts.addedFromMedicare} added from further down the Medicare list, ${overTheCounterCounts.added} added new.`);

// ---- Build

const output = [];
async function addMedication(medication, { requireHomeForm }) {
  const drugs = await clinicalDrugsFor(medication.generic).catch((error) => {
    console.warn(`  ${medication.generic}: ${error.message}`);
    return [];
  });
  if (requireHomeForm && (WHO_CLINIC_ONLY.test(medication.generic) || !drugs.some((drug) => !isInjection(drug.form)))) return false;
  const name = displayName(medication.generic, drugs);
  const searchTerms = new Set([...medication.aliases, medication.generic].filter((alias) => rawWords(alias).join(" ") !== rawWords(name).join(" ")));
  output.push({
    name,
    // Brands by how often they are prescribed, most common first.
    brands: [...medication.brands.entries()].sort((a, b) => b[1] - a[1]).map(([brand]) => brand).slice(0, MAXIMUM_BRANDS_PER_MEDICATION),
    // Other names to search by: the CMS spelling and the WHO's international name.
    aliases: [...searchTerms],
    // Place among Medicare Part D prescriptions (1 = most prescribed), or null if not prescribed there.
    rank: medication.rank,
    // The WHO list section, when this is a WHO essential medicine.
    who: medication.whoSection ?? null,
    // The kind of home remedy ("Constipation"), when it is sold over the counter.
    otc: medication.overTheCounter ?? null,
    strengths: strengthList(drugs),
  });
  return true;
}

for (const [index, medication] of chosen.entries()) {
  await addMedication(medication, { requireHomeForm: false });
  if ((index + 1) % 200 === 0) console.log(`  ${index + 1} of ${chosen.length} prescribed medications`);
}
for (const medication of whoOnlyCandidates) {
  // An over-the-counter remedy is given at home by definition.
  if (await addMedication(medication, { requireHomeForm: !medication.overTheCounter })) whoCounts.fromWhoAlone++;
  else whoCounts.notGivenAtHome++;
}
console.log(`WHO: ${whoCounts.inTop} already in the top ${MEDICATION_COUNT}; added ${whoCounts.fromLowerInMedicare} from further down the Medicare list `
  + `and ${whoCounts.fromWhoAlone} from the WHO list alone; left out ${whoCounts.notGivenAtHome} not sold in the U.S. in a home form `
  + `and ${whoCounts.groupsAndVaccines} groups and vaccines.`);

mkdirSync("public/data", { recursive: true });
writeFileSync(OUTPUT_FILE, JSON.stringify({
  about: "The 1,000 most commonly prescribed medications in Medicare Part D (CMS), most common first, cross-referenced with "
    + "the WHO Model List of Essential Medicines 2025 (WHO, CC BY-NC-SA 3.0 IGO; essential medicines outside the top 1,000 follow), "
    + "plus common over-the-counter home remedies with their store brands, "
    + "with strengths and forms from RxNorm (U.S. National Library of Medicine). Built by scripts/build-medication-list.mjs.",
  builtOn: new Date().toISOString().slice(0, 10),
  // Each entry: name, brands, aliases (other search terms), rank, who (WHO section or null),
  // otc (kind of home remedy or null), strengths as [strength, dose form] pairs.
  medications: output,
}));
const withStrengths = output.filter((medication) => medication.strengths.length).length;
const topWithStrengths = output.slice(0, 300).filter((medication) => medication.strengths.length).length;
console.log(`Wrote ${OUTPUT_FILE}: ${output.length} medications, ${withStrengths} with strengths (${topWithStrengths} of the top 300), `
  + `${output.filter((medication) => medication.who).length} WHO essential, ${output.filter((medication) => medication.otc).length} over the counter.`);
