# ⚕ MEDTERM — Symptom & Drug Reference Terminal

A CRT-styled medical **reference** terminal with two directions:

- **◈ SYMPTOM** — type or pick a symptom (headache, fever, heartburn, cough…)
  and see the **generic drugs commonly used** for it, plus general self-care
  advice. Click any drug to flip to its profile.
- **⚗ DRUG** — type a generic drug name (ibuprofen, metformin, cetirizine…)
  and see its **class**, **what it treats**, and the **key caution** for it.
- **▚ PLAN** — plan for a *real patient*: add several symptoms at once and the
  engine finds the **fewest drugs covering the most symptoms** (preferring OTC
  and in-stock items), flags **drugs that are common for one symptom but risky
  given another** (e.g. ibuprofen for a headache when the patient also has
  stomach pain), and plans around the **clinic's own stock list** (saved
  locally).

Ships with a curated dataset: **66 symptoms across 15 categories** and **76
common generic drugs**, fully cross-linked in both directions. 100%
client-side — no server, no uploads, no API keys.

> ⚠ **This is an informational reference, NOT medical advice.** It lists
> common generic drugs and general uses — it does not diagnose, dose, or
> prescribe. Never start, stop, or change medicines on your own. Talk to a
> clinician or pharmacist, and call emergency services for urgent symptoms.

---

## Quick start

Serve the folder (any PHP/static server) and open `medterm/index.html`, or
double-click the file — it works straight from disk.

### Symptom → drugs

- Type in the `sym>` box — suggestions appear after 2 characters (fuzzy:
  `hartburn` still finds *heartburn*). `↑`/`↓`/`Enter` or click to pick.
- Or click a **category chip** (Pain · Cold & Flu · Allergy · Digestive ·
  Skin · Sleep & Mood · Heart · Lungs · Urinary · Metabolic · Eyes · etc.)
  to browse that category.
- Each symptom shows self-care tips and drug tags — green = OTC, amber =
  prescription. Clicking a drug opens its full profile.

### Plan for a patient (rural-clinic workflow)

1. In the **▚ PLAN** tab, add every symptom the patient reports — type in the
   `pt>` box (fuzzy autocomplete) and press Enter. Add as many as you like;
   chips appear with a ✕ to remove.
2. Optional but powerful: tick the **CLINIC STOCK** list (or hit **ALL OTC**)
   so the plan only recommends what's actually on the shelf. The list is saved
   in the browser and remembered between visits. **NONE** clears it — an empty
   configured stock means "we carry nothing", so the plan refers onward.
3. Press **▚ RUN PLAN**. The output shows:
   - **RECOMMENDED** items with exactly which symptoms each covers, plus
     `✓ IN STOCK` / `✗ NOT STOCKED` / `RX` badges (click one for its profile),
   - a **single-agent** callout when one medicine covers everything,
   - **ALTERNATIVES** also usable,
   - **AVOID HERE** — the critical safety block: drugs that are right for one
     listed symptom but can worsen another, with the reason,
   - a warning when no suitable stocked option exists.

#### The classic example: stomach pain + headache

The engine recommends **acetaminophen for the headache** and a stomach-safe
item (antacid/simethicone) for the stomach — and puts **ibuprofen, naproxen
and aspirin in the AVOID block** (NSAIDs can irritate the stomach lining). No
single drug safely covers both, so no single-agent claim is made.

### Drug → info

- Type in the `rx>` box (fuzzy suggestions too).
- Profile shows: OTC/Rx badge, drug class, what it does, **used for**
  (each symptom is clickable to flip back), and a **key caution**.

## What's in the data

- Only **generic** drug names, so it stays useful across brands and regions.
- Common OTC + well-known prescription generics: analgesics/NSAIDs, cold &
  allergy, digestive (PPIs, H2 blockers, laxatives, antidiarrheals),
  dermatology (antifungals, acne, eczema), sleep & anxiety, heart
  (BP/cholesterol), asthma, UTI, diabetes, eyes, ED, vitamins, nicotine
  replacement.
- Each drug has a plain-language caution for the most important real-world
  risk (liver limit for acetaminophen, no aspirin in children, NSAID ulcer
  risk, decongestants & hypertension, nitrate + ED-med danger, etc.).

## Files

```
medterm/
├── index.html       # two-tab lookup UI
├── assets/
│   ├── data.js      # curated symptom + drug dataset (MED_DATA)
│   ├── style.css    # CRT effects, chips, suggestion dropdown
│   └── app.js       # fuzzy search, autocomplete, rendering, cross-links
└── README.md
```

## Data integrity

The dataset is cross-checked at build time by a script: every drug a symptom
lists must exist *and* list that symptom back (and vice-versa), categories must
be known, and no entry may be a dead end. Every `avoidSym` rule must reference a
real symptom. 66 symptoms / 76 drugs currently pass all checks.

## The plan engine, simply

For the symptoms given, it builds the pool of drugs that treat at least one of
them, then:
1. **Scores** each drug: symptoms covered (×1000) > in stock (×200) > OTC over
   Rx (×50), so a stocked multi-symptom OTC item wins.
2. **Avoids conflicts** — a drug whose curated `avoidSym` rule matches any
   listed symptom is moved to the AVOID block with its reason and can never be
   recommended for that patient.
3. **Covers greedily** — repeatedly picks the best remaining drug until every
   symptom is covered, minimizing the number of items.
4. **Reports honestly** — single-agent only when one item truly covers all;
   otherwise a small combination; never claims coverage it doesn't have.

## Notes

- Drugs appear for well-established general uses only; this is deliberately a
  *reference*, not a decision tool.
- No dosages are given on purpose — dosing depends on age, weight, kidney
  function and other medicines.
- Suggestions rank prefix > contains > subsequence, so mild typos still work.