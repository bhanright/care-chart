# Care Chart

A shared medical chart for caring for a family member at home. It records medications
(scheduled and as-needed), when each dose was given and by whom, mood and behavior,
fluids, meals, bowel movements, urination, sleep, pain, vital signs and personal care.
Two or more caregivers sign in from their own phones or computers and see the same
chart, updated within about 15 seconds.

It runs free on Cloudflare: a Worker serves the app and the API, a D1 (SQLite)
database holds the chart, and a scheduled job sends dose reminders to phones. The free
plan's limits (100,000 requests and 5 million database reads a day, 5 GB of storage)
are far above what one household uses.

## What it does

- **Today**: doses due or overdue (one tap records "given now", with Undo), today's
  medication administration record, each as-needed medication's last dose, how long it
  keeps working, when the next dose is allowed and how many were given in 24 hours, a
  "did it help?" follow-up, totals for the day (fluids against a goal, last bowel
  movement, urinations, meals, mood) and the notable changes of the last three days.
- **Safety checks**: two caregivers cannot both record the same scheduled dose (the
  second is told who gave it and when); an as-needed dose that is too soon or over the
  daily limit needs a written reason, whether it is recorded or edited afterward; records
  are never deleted, only marked "entered in error" with a reason; every record shows
  who made and who last changed it; and a save made from an out-of-date screen is
  refused rather than overwriting the other caregiver's change.
- **Three access levels** for caregivers, chosen when an account is added and changeable
  later in Settings → Caregivers (the server enforces them, so a hidden button is never
  the only guard):
  - **Full access**: everything, including medications and schedules, the visit
    calendar, the patient profile, household settings, caregivers and the backup.
  - **Records care**: sees everything; records doses, observations, notes and what
    happened at visits, and corrects those entries. Cannot change medications, schedules,
    the visit calendar, the profile, settings or caregivers.
  - **View only**: sees the whole chart (forms open read-only) and changes nothing.

  Everyone manages their own name, password, sign-outs and reminders. Nobody can change
  their own access, so there is always someone with full access. Accounts made before
  access levels existed have full access.
- **Schedule changes** count from the moment they are made, so adding a dose time in the
  afternoon never makes that morning, or any earlier day, look missed. Doses recorded
  under an old schedule stay in the record.
- **Medications**: the current list with schedules (times and days), as-needed limits,
  courses with a last day, and stopped medications with the reason. Typing a name
  suggests matches from a built-in list (below); choosing one fills in the name, offers
  that medication's strengths and sets the route.
- **Visits**: a calendar for the care team (hospice nurses, aides, social workers,
  chaplains and others). Plan one visit or a weekly series, then mark what happened:
  completed, declined care (and what she declined), cancelled by hospice or family, or
  no-show. Today shows the day's visits and asks about any that passed unrecorded;
  declined and cancelled visits appear among notable changes and in the report.
- **Briefs and small amounts**: bowel movements and urination record where they happened
  (brief, toilet, bedpan, or an accident outside the brief, the only one counted as an
  accident), starting from the last choice. Quick water has sips (5, 10, 15 mL), and an
  Ensure / shake button records a meal replacement and its fluids together.
- **Log**: any day's chart, filtered by type and searchable; edit or mark in error.
- **Trends**: 7 to 90 days of fluids, dose adherence, bowel movements, urination, meals,
  mood, difficult behaviors, pain, sleep, vital signs and as-needed use.
- **Report**: a printable summary for a date range to take to the doctor, a CSV for
  spreadsheets, and a full JSON backup.
- **Reminders**: every 5 minutes the server checks for doses falling due or overdue and
  for "did it help?" follow-ups, and sends a notification to each phone that turned
  reminders on, even with Care Chart closed and the screen locked. Without the reminder
  keys (below), a device still reminds you while the app is open.
- **One household clock**: dose times follow the household time zone (Settings), not
  each phone's, so both phones agree on which dose is which even if one is traveling.
- Phone-friendly, installable to the home screen, a Night theme and a Large text option
  (per device), and keyboard shortcuts on computers (press `?`).
- **Seventeen looks**, chosen per device in Settings → This device → Look (or with `?look=<key>`
  in the address: `classic`, `win98`, `xp`, `vista`, `win7`, `win10`, `mac`, `aqua`, `tahoe`, `ubuntu`,
  `yaru`, `kde`, `neon`, `studio`, `honey`, `lavender`, `gram`). The menu lists them in two
  groups, **OS-Like** (Classic through KDE Plasma) and **Other** (the rest):
  - **Classic** (Windows 95), the default;
  - **Windows 98** (the teal desktop, flat Internet Explorer 4 style toolbar buttons, and
    Windows 98 color schemes: Windows Standard, Rainy Day, Eggplant, Marine, Plum, Spruce,
    Desert);
  - **Windows XP** (Luna: rounded blue title bars, Explorer task-pane sections, soft XP
    buttons, green progress blocks, a Bliss-style sky) in XP's Blue, Olive Green or Silver;
  - **Windows 7** (Aero: tinted glass frames, the wide red close button, glossy buttons,
    Control Panel–style sections, a Harmony-style wallpaper) in Sky, Twilight, Leaf or Rose;
  - **Windows 10** (flat and square: white title bars with wide caption buttons and the red
    close, pivot tabs, the dashboard figures as Start-menu live tiles, the Win32 green
    progress bar, dark Action Center notifications, the status bar as the taskbar on wide
    screens, a Hero-style wallpaper) in Blue, Teal, Green, Purple or Storm, with Windows
    10's dark mode at night;
  - **Mac OS 8/9** (Platinum: pinstriped title bars with centered titles and the close box on
    the left, ringed default buttons in dialogs, lavender highlights, Balloon Help tips);
  - **Mac OS X (Aqua)** (pinstripes, the red/yellow/green window buttons, gel buttons with a
    pulsing blue default, a segmented tab control, striped progress, forms that drop down
    as sheets, Growl-style notices) in Blue, Graphite or Brushed Metal;
  - **macOS Tahoe** (Liquid Glass: translucent, deeply rounded windows over a lake-and-
    mountains wallpaper, the red/yellow/green window buttons, capsule buttons, tabs as a
    floating glass segmented control, glass notification banners, the status bar as a
    Dock-like shelf on wide screens) in six macOS accent colors, with dark glass at night;
  - **Ubuntu (GNOME 2, before Unity)** in Human (brown-orange, 6.06–9.10), Ambiance or
    Radiance (10.04/10.10, window buttons on the left): bold indented GNOME-style sections,
    Clearlooks-style buttons, dark notification bubbles top right, and on wide screens the
    status bar as the bottom panel;
  - **Ubuntu (modern)** (22.04/24.04 with Yaru: rounded windows, the orange round close
    button, sections as rounded cards under bold headings, flat buttons, a pill toast) in
    Ubuntu's ten accent colors;
  - **KDE Plasma** (Plasma 6 with Breeze: centered titles, blue focus rings, a red close on
    hover, white cards, accent-underlined tabs, notification cards and a floating panel) in
    six accent colors;
  - **Neon Material**, a wildcard: an imagined operating system that is half Material Design
    (elevation, an app bar, uppercase buttons with a ripple, underlined fields, sliding tab
    indicator, snackbar) and half cyberpunk (neon glow, cut corners, scanlines, a city grid,
    monospaced readouts, a glitching title), in Neon City, Toxic, Synthwave or Ice. Night is
    its native mode;
  - **Studio**, a 2024 studio-website style fitted to the chart's layout: cream paper with a
    little grain, every section a rounded card with a header strip, Instrument Serif headings
    over Inter, small monospace labels, an underlined tab row and one accent color (Acid
    lime, Sage, Terracotta, Lavender or Cobalt);
  - **Honey**, warm and friendly: butter-colored paper with a faint honeycomb, cream cards
    under amber header strips, dark brown ink, the rounded Nunito typeface and jar-like
    tabs, in Wildflower, Clover or Buckwheat;
  - **Lavender**, calm and soft: a misty lilac sky over faint lavender sprigs, frosted white
    cards with plum headings marked by a lilac bar, a pill-shaped tab bar and Nunito, in
    Provence, Twilight or Sachet (dusty lavender with a sage-green accent);
  - **The Gram**, in the style of a photo-sharing app's feed (no logos or brand art):
    sections as posts with story rings, the patient banner as a profile header, profile-style
    tabs, blue main buttons, the sunset gradient and a script wordmark; true black at night.

  The first time someone signs in on a phone or computer, a **Choose a look** window
  shows every look as a small picture, grouped the same way, with each look's color
  schemes and Day/Night; choosing one restyles the app behind it at once. It is offered
  once per device (`public/js/look-picker.js`).

  The looks and their groups are listed in `public/js/looks.js`; each one other than Classic is one stylesheet
  in `public/css/` whose rules all sit inside `:root[data-skin="<key>"]`, so looks never
  affect each other. Backgrounds are drawn in CSS, not copied from the originals. Studio's,
  Honey's and Lavender's fonts are in `public/fonts/` under the SIL Open Font License (license texts
  alongside); a device downloads them only while that look is in use.

## Put it online (about 10 minutes)

You need a free Cloudflare account. On Windows PowerShell, type `npx.cmd` where these
steps say `npx`, since the execution policy blocks `npx.ps1`.

1. Install the tools:

   ```bash
   npm install
   ```

2. Sign in to Cloudflare (opens the browser):

   ```bash
   npx wrangler login
   ```

3. Create the database:

   ```bash
   npx wrangler d1 create care-chart
   ```

   Copy the `database_id` it prints into `wrangler.jsonc`, replacing the zeros.

4. Choose a setup code: a long phrase only you know. It is needed once, to create the
   first account, so a stranger who finds the address cannot claim the chart first.

   ```bash
   npx wrangler secret put SETUP_CODE
   ```

5. Create the tables and publish:

   ```bash
   npm run deploy
   ```

   This copy is served at **https://carechart.us** (set under `routes` in `wrangler.jsonc`;
   the domain must be a zone in the same Cloudflare account). For a deployment of your own,
   change or remove `routes`, and set `workers_dev` to `true` to use a free
   `https://care-chart.<your-name>.workers.dev` address instead.

6. Open the address, enter the setup code, and create your account. Then, in
   **Settings → Caregivers**, add the other caregiver's account and tell them the
   password in person. Fill in **Settings → Patient** (allergies first), check the
   household time zone, add the medications, and on each phone open the address, choose
   **Add to Home screen**, open it from the home screen, and press **Turn on reminders
   for this device** in Settings.

### Dose reminders (do this before step 5, or redeploy after)

Reminders with the app closed use Web Push, which needs a key pair that identifies your
server to the phones' push services. Make one, and store both halves as secrets:

```bash
npm run vapid
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

Paste each value when asked. Then set `VAPID_SUBJECT` in `wrangler.jsonc` to your site's
address (or `mailto:you@example.com`); push services use it only to contact the sender
about problems. Keep the keys: making new ones means every phone must turn
reminders on again. On iPhone (iOS 16.4 or later), reminders work only from the
home-screen app, not from a Safari tab.

To publish a later change, push it to `main` on GitHub: Cloudflare Workers Builds is
connected to the repository and runs `npm run deploy`, which applies any new database
migrations first and then deploys. (Running `npm run deploy` yourself does the same.) Only
`main` builds; other branches do not, since a preview would share the real chart's
database.

### Optional: a second lock with Cloudflare Access

Care Chart has its own passwords, lockout after repeated wrong passwords, and
secure sessions. For a second layer, put Cloudflare Access (free for up to 50 people) in
front of it: in the Cloudflare dashboard, open **Zero Trust → Access → Applications**,
add a self-hosted application for the Care Chart address, and allow only your two email
addresses. Each phone then confirms an emailed code about once a month before the
Care Chart sign-in appears.

### Forgotten passwords and lost phones

- **Settings → Caregivers → Reset password** sets a new password for the other caregiver
  (you confirm with your own) and signs them out everywhere.
- Changing your own password signs you out on your other devices, and **Sign out other
  devices** does the same without changing it.

### Backups

- **Report → Full backup (JSON)** downloads the whole chart. Keep one now and then.
- Cloudflare D1 also keeps a rolling history (Time Travel) and can restore the database
  to any minute in the last 7 days on the free plan:
  `npx wrangler d1 time-travel restore care-chart --timestamp=<when>`.

## The medication list

`public/data/medications.json` (about 280 KB, loaded only when the medication form
opens) holds:

- the **1,000 most prescribed medications** in Medicare Part D, ranked by total
  prescriptions in the CMS "Medicare Part D Prescribers - by Geography and Drug" data
  (U.S. government, public domain), with their brand names. Medicare mostly covers people
  over 65, which suits this app. Supplies (needles, test strips) and vaccines are left out;
- a **cross-reference with the WHO Model List of Essential Medicines** (24th list, 2025,
  and the children's list): matching medicines are marked "WHO" in the suggestions, the
  WHO's international name becomes a search term (so "paracetamol" finds acetaminophen and
  "salbutamol" finds albuterol), and WHO essential medicines outside Medicare's top 1,000
  are added when they are sold in the U.S. in a form given at home. The WHO list is
  (c) World Health Organization, licensed CC BY-NC-SA 3.0 IGO (non-commercial use with
  attribution), which suits a family app; the form credits it;
- **common over-the-counter remedies** families keep at home (pain relievers, laxatives,
  antacids, allergy and sleep aids, creams, vitamins), hand-picked in
  `scripts/data/over-the-counter.csv` with the store brands people ask for by name, so
  "Tylenol", "MiraLAX" or "Tums" find the right product. Medicare rarely pays for these, so
  they are missing from its counts. They are marked "OTC" in the suggestions;
- **strengths and dose forms** from RxNorm (U.S. National Library of Medicine), which also
  supplies clean ingredient names for CMS's shortened ones ("Triamterene/Hydrochlorothiazid").

To rebuild it (for example when CMS publishes a new year), download the WHO list from
https://list.essentialmeds.org/ (Export → Excel) and run:

```bash
python scripts/extract_who_eml.py path/to/eml.xlsx
npm run build:medications
```

## Working on it

```bash
npm run dev            # local server at http://localhost:8790 (uses .dev.vars); the
                       # reminder job runs on demand at http://localhost:8790/__scheduled
npm run migrate:local  # create the local tables (once)
npm run seed:local     # two weeks of made-up demo data; sign in as "Demo Caregiver" (full
                       # access), "Second Caregiver" (records care) or "View Only Demo"
npm run check          # tests for the dose-timing rules and the medication search
npm run typecheck      # type-checks the Worker
```

Copy `.dev.vars.example` to `.dev.vars` for local development. The demo password is in
`scripts/seed-local.mjs`, which only runs against localhost.

### Layout

| Path | What it is |
|---|---|
| `src/worker.ts` | Entry point: static files, the CSRF header check, routing |
| `src/auth.ts` | Caregiver accounts, passwords (PBKDF2), sessions, lockout |
| `src/access.ts` | The three access levels and which requests need which (mirrored for the screens in `public/js/access.js`) |
| `src/chart.ts` | Medications, doses (with the safety checks), observations, settings, export |
| `src/reminders.ts` | The scheduled reminder job, and devices turning reminders on and off |
| `src/push.ts` | Web Push sending (VAPID and encryption with WebCrypto, no dependencies) |
| `src/http.ts` | JSON responses and input checking |
| `migrations/` | Database schema |
| `public/js/schedule.js` | Dose timing: due, overdue, as-needed limits; shared with the reminder job (tested by `scripts/check-schedule.mjs`) |
| `public/js/time.js` | Household-time-zone dates and clock times; shared with the reminder job |
| `public/js/push.js` | Turning reminders on and off on a device |
| `public/js/looks.js` | The looks, their groups and their color schemes |
| `public/css/win98.css`, `xp.css`, `vista.css`, `win7.css`, `win10.css`, `mac.css`, `ubuntu.css`, `yaru.css`, `kde.css`, `aqua.css`, `tahoe.css`, `neon.css`, `studio.css`, `honey.css`, `lavender.css`, `gram.css` | The other sixteen looks |
| `public/images/win10-wallpaper.svg`, `tahoe-wallpaper.svg` | Wallpapers for the Windows 10 and macOS Tahoe looks (drawn for Care Chart) |
| `design/logo-concepts/` | The logo concepts not used (kept for later), not served |
| `public/images/logo.png`, `public/icon-192.png`, `public/icon-512.png` | The logo (a gradient cross with a heart, generated with GPT-5.4 Image 2) and the app icons made from it |
| `public/fonts/` | Fonts for Studio, Honey and Lavender, with their licenses |
| `public/js/medication-search.js` | Medication name suggestions from `public/data/medications.json` |
| `scripts/build-medication-list.mjs` | Builds that list from CMS, WHO and RxNorm data |
| `public/js/entry-types.js` | The observation types and their fields; add a field here and the forms, log and report pick it up |
| `public/js/forms.js` | The dialogs that write to the chart |
| `public/js/views/` | One file per tab |
| `public/css/chart.css` | The Windows 95 look, day and night themes |

Times are stored in UTC. Dose slots and everything shown use the household time zone
from Settings, so a phone set to another zone still shows and records household time
(the status bar says so).

This is a family record-keeping tool, not a medical device. It does not replace the
prescriber's instructions or a pharmacist's advice; check doses against the label.
