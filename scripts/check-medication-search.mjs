// Checks the medication name suggestions against the shipped list. Run with `npm run check`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareMedicationList, routeForForm, searchMedications } from "../public/js/medication-search.js";

const medications = prepareMedicationList(JSON.parse(readFileSync(new URL("../public/data/medications.json", import.meta.url), "utf8")));
let checks = 0;
const check = (name, test) => { test(); checks++; console.log(`ok - ${name}`); };
const first = (typed) => searchMedications(medications, typed)[0];

check("the list has the top 1,000 plus WHO additions, most prescribed first", () => {
  assert.ok(medications.length >= 1000);
  assert.equal(medications[0].rank, 1);
  assert.ok(medications.filter((medication) => medication.who).length > 300);
});

check("a generic name prefix finds the medication", () => {
  assert.equal(first("lisin").medication.name, "Lisinopril");
  assert.match(first("donep").medication.name, /^Donepezil/);
});

check("a brand name finds the generic and remembers the brand", () => {
  const result = first("eliqu");
  assert.equal(result.medication.name, "Apixaban");
  assert.equal(result.matchedBrand, "Eliquis");
});

check("an international name finds the U.S. one", () => {
  assert.equal(first("paracetamol").medication.name, "Acetaminophen");
  assert.equal(first("salbutamol").medication.name.split(" ")[0], "Albuterol");
});

check("more prescribed medications come first among equal matches", () => {
  const names = searchMedications(medications, "metop").map((result) => result.medication.name);
  assert.ok(names.length >= 2);
  assert.match(names[0], /^Metoprolol/);
});

check("one letter suggests nothing; nonsense finds nothing", () => {
  assert.equal(searchMedications(medications, "l").length, 0);
  assert.equal(searchMedications(medications, "zzqx").length, 0);
});

check("store brands find over-the-counter remedies", () => {
  assert.equal(first("tylenol").medication.name, "Acetaminophen");
  assert.equal(first("tylenol").medication.otc, "Pain and fever");
  assert.match(first("miralax").medication.name, /^Polyethylene Glycol 3350/);
  assert.match(first("colace").medication.name, /^Docusate/);
});

check("mineral salts stay apart: Tums is calcium carbonate, not calcium acetate", () => {
  assert.equal(first("tums").medication.name, "Calcium Carbonate");
  const acetate = medications.find((medication) => medication.name === "Calcium Acetate");
  assert.ok(acetate && !acetate.brands.includes("Tums") && !acetate.otc);
});

check("dose forms map to the form's route words", () => {
  assert.equal(routeForForm("Oral Tablet"), "by mouth");
  assert.equal(routeForForm("Metered Dose Inhaler"), "inhaled");
  assert.equal(routeForForm("Ophthalmic Solution"), "eye drops");
  assert.equal(routeForForm("Auto-Injector"), "injection");
});

console.log(`\n${checks} checks passed.`);
