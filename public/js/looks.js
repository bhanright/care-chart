// The looks Care Chart can wear, chosen per device in Settings → This device → Look.
// Each look other than Classic is one stylesheet in public/css/ whose rules all sit
// inside :root[data-skin="<key>"], so looks never affect each other. A look may offer
// color schemes; the chosen one is set as data-scheme on <html>.

export const LOOKS = [
  { key: "classic", label: "Classic (Windows 95)", schemes: [] },
  {
    key: "win98",
    label: "Windows 98",
    // A selection of Windows 98's named color schemes.
    schemes: [
      { value: "standard", label: "Windows Standard" }, { value: "rainy-day", label: "Rainy Day" },
      { value: "eggplant", label: "Eggplant" }, { value: "marine", label: "Marine" }, { value: "plum", label: "Plum" },
      { value: "spruce", label: "Spruce" }, { value: "desert", label: "Desert" },
    ],
  },
  {
    key: "xp",
    label: "Windows XP",
    schemes: [{ value: "blue", label: "Blue" }, { value: "olive", label: "Olive Green" }, { value: "silver", label: "Silver" }],
  },
  {
    key: "vista",
    label: "Windows Vista",
    // Glass colors from Vista's Window Color and Appearance settings.
    schemes: [
      { value: "default", label: "Default" }, { value: "graphite", label: "Graphite" },
      { value: "blue", label: "Blue" }, { value: "teal", label: "Teal" }, { value: "red", label: "Red" },
    ],
  },
  {
    key: "win7",
    label: "Windows 7",
    // Aero glass colors from Windows 7's Personalization settings.
    schemes: [{ value: "sky", label: "Sky" }, { value: "twilight", label: "Twilight" }, { value: "leaf", label: "Leaf" }, { value: "rose", label: "Rose" }],
  },
  { key: "mac", label: "Mac OS 8/9 (Platinum)", schemes: [] },
  {
    key: "aqua",
    label: "Mac OS X (Aqua)",
    // Aqua's two appearances, and the brushed-metal windows of 10.3 and 10.4.
    schemes: [{ value: "blue", label: "Blue" }, { value: "graphite", label: "Graphite" }, { value: "brushed-metal", label: "Brushed Metal" }],
  },
  {
    key: "ubuntu",
    label: "Ubuntu (GNOME 2, before Unity)",
    schemes: [
      { value: "human", label: "Human (6.06–9.10)" },
      { value: "ambiance", label: "Ambiance (10.04)" },
      { value: "radiance", label: "Radiance (10.04)" },
    ],
  },
  {
    key: "yaru",
    label: "Ubuntu (modern)",
    // Ubuntu's accent colors (Settings → Appearance).
    schemes: [
      { value: "orange", label: "Orange" }, { value: "bark", label: "Bark" }, { value: "sage", label: "Sage" },
      { value: "olive", label: "Olive" }, { value: "viridian", label: "Viridian" }, { value: "prussian-green", label: "Prussian green" },
      { value: "blue", label: "Blue" }, { value: "purple", label: "Purple" }, { value: "magenta", label: "Magenta" },
      { value: "red", label: "Red" },
    ],
  },
  {
    key: "kde",
    label: "KDE Plasma",
    // Accent colors from Plasma's Colors settings.
    schemes: [
      { value: "blue", label: "Breeze blue" }, { value: "purple", label: "Purple" }, { value: "green", label: "Green" },
      { value: "orange", label: "Orange" }, { value: "red", label: "Red" }, { value: "teal", label: "Teal" },
    ],
  },
  {
    key: "neon",
    label: "Neon Material (wildcard)",
    // An imagined operating system: Material Design crossed with cyberpunk.
    schemes: [
      { value: "neon-city", label: "Neon City" }, { value: "toxic", label: "Toxic" },
      { value: "synthwave", label: "Synthwave" }, { value: "ice", label: "Ice" },
    ],
  },
  {
    key: "studio",
    label: "Studio",
    // A 2024 studio-website style: cream paper, serif headings, one accent color.
    schemes: [
      { value: "lime", label: "Acid lime" }, { value: "sage", label: "Sage" },
      { value: "terracotta", label: "Terracotta" }, { value: "lavender", label: "Lavender" },
      { value: "cobalt", label: "Cobalt" },
    ],
  },
  {
    key: "honey",
    label: "Honey",
    // Warm and friendly: butter, amber and brown, rounded type and a faint honeycomb.
    schemes: [
      { value: "wildflower", label: "Wildflower" }, { value: "clover", label: "Clover" },
      { value: "buckwheat", label: "Buckwheat" },
    ],
  },
];

export const DEFAULT_LOOK = "classic";

export function lookByKey(key) {
  return LOOKS.find((look) => look.key === key) ?? LOOKS.find((look) => look.key === DEFAULT_LOOK);
}

/** The scheme to use for a look: the saved choice if the look has it, else the look's first. */
export function schemeFor(lookKey, savedSchemes = {}) {
  const look = lookByKey(lookKey);
  const saved = savedSchemes[look.key];
  return look.schemes.some((scheme) => scheme.value === saved) ? saved : look.schemes[0]?.value ?? "";
}
