/* ============================================================
   MEDTERM — Symptom & Drug reference terminal
   Informational only — NOT medical advice.
   ============================================================ */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);
const D = MED_DATA;

function pad(n) { return String(n).padStart(2, "0"); }

const DISCLAIMER =
    "⚠ INFORMATIONAL ONLY — NOT MEDICAL ADVICE. This reference lists common " +
    "generic drugs and general uses. It does not diagnose, dose, or prescribe. " +
    "Never start, stop, or change medicines on your own — talk to a qualified " +
    "clinician or pharmacist, and call emergency services for urgent symptoms.";

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

const TAB_PANELS = { sym: "panelSym", drug: "panelDrug", plan: "panelPlan" };
const TAB_BTNS = { sym: "btnTabSym", drug: "btnTabDrug", plan: "btnTabPlan" };
const TAB_LABELS = { sym: "SYMPTOM", drug: "DRUG", plan: "PLAN" };
const TAB_INFO = {
    sym: "symptom → commonly used drugs",
    drug: "drug → class · treats · caution",
    plan: "multi-symptom plan · stock-aware · conflict checks",
};

function showTab(which) {
    for (const k of Object.keys(TAB_PANELS)) {
        $(TAB_PANELS[k]).classList.toggle("hidden", k !== which);
        $(TAB_BTNS[k]).classList.toggle("active", k === which);
    }
    $("stMode").textContent = TAB_LABELS[which];
    $("stInfo").textContent = TAB_INFO[which];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tag(label, cls, onClick, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mt-tag" + (cls ? " " + cls : "");
    b.textContent = label;
    if (title) b.title = title;
    if (onClick) b.addEventListener("click", onClick);
    return b;
}

/* ------------------------------------------------------------------ */
/* Symptom → drugs                                                     */
/* ------------------------------------------------------------------ */

function renderSymptom(key) {
    const s = D.symptoms[key];
    if (!s) return;
    const cats = $("symCats");
    if (cats) cats.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
    const out = $("symOut");
    out.textContent = "";

    const count = document.createElement("div");
    count.className = "mt-count";
    count.textContent = "MATCH // " + s.label.toUpperCase() + " — " + s.drugs.length + " commonly used option(s)";
    out.appendChild(count);

    const card = document.createElement("div");
    card.className = "mt-card";
    const title = document.createElement("div");
    title.className = "mt-card-title";
    title.textContent = s.label;
    card.appendChild(title);

    const tagrow = document.createElement("div");
    tagrow.className = "mt-tagrow";
    tagrow.appendChild(tag(D.categories[s.cat] || s.cat, "cat"));
    card.appendChild(tagrow);

    const self = document.createElement("div");
    self.className = "mt-sec";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = "SELF-CARE // ";
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = s.selfcare;
    self.appendChild(k);
    self.appendChild(v);
    card.appendChild(self);

    const drugsSec = document.createElement("div");
    drugsSec.className = "mt-sec";
    const dk = document.createElement("span");
    dk.className = "k";
    dk.textContent = "COMMONLY USED // click to flip to the drug profile";
    drugsSec.appendChild(dk);
    const drow = document.createElement("div");
    drow.className = "mt-tagrow";
    for (const drugKey of s.drugs) {
        const dr = D.drugs[drugKey];
        if (!dr) continue;
        const t = tag(dr.name, dr.rx ? "rx" : "otc", () => {
            $("drugSearch").value = dr.name;
            renderDrug(drugKey);
            showTab("drug");
            $("drugSearch").focus();
        });
        t.title = (dr.rx ? "Prescription" : "OTC") + " · " + dr.cls;
        drow.appendChild(t);
    }
    drugsSec.appendChild(drow);
    card.appendChild(drugsSec);
    out.appendChild(card);

    const disc = document.createElement("div");
    disc.className = "mt-disclaimer";
    disc.textContent = DISCLAIMER;
    out.appendChild(disc);

    $("symSearch").value = s.label;
    $("stInfo").textContent = s.drugs.length + " drug(s) for " + s.label.toLowerCase();
}

function showCategory(catKey) {
    const out = $("symOut");
    out.textContent = "";
    const list = Object.entries(D.symptoms).filter(([, s]) => s.cat === catKey);
    const count = document.createElement("div");
    count.className = "mt-count";
    count.textContent = "CATEGORY // " + (D.categories[catKey] || catKey).toUpperCase() + " — " + list.length + " symptom(s)";
    out.appendChild(count);
    for (const [key, s] of list) {
        const card = document.createElement("div");
        card.className = "mt-card";
        const title = document.createElement("button");
        title.type = "button";
        title.className = "mt-card-title";
        title.style.background = "none";
        title.style.border = "none";
        title.style.padding = "0";
        title.style.cursor = "pointer";
        title.style.textAlign = "left";
        title.textContent = s.label;
        title.addEventListener("click", () => renderSymptom(key));
        card.appendChild(title);
        const tagrow = document.createElement("div");
        tagrow.className = "mt-tagrow";
        for (const drugKey of s.drugs.slice(0, 4)) {
            const dr = D.drugs[drugKey];
            if (!dr) continue;
            tagrow.appendChild(tag(dr.name, dr.rx ? "rx" : "otc", () => {
                $("drugSearch").value = dr.name;
                renderDrug(drugKey);
                showTab("drug");
            }));
        }
        if (s.drugs.length > 4) {
            const more = document.createElement("span");
            more.className = "mt-tag cat";
            more.textContent = "+" + (s.drugs.length - 4) + " more";
            tagrow.appendChild(more);
        }
        card.appendChild(tagrow);
        out.appendChild(card);
    }
    const disc = document.createElement("div");
    disc.className = "mt-disclaimer";
    disc.textContent = DISCLAIMER;
    out.appendChild(disc);
    $("symSearch").value = "";
    $("stInfo").textContent = D.categories[catKey] + " — " + list.length + " symptom(s)";
}

/* ------------------------------------------------------------------ */
/* Drug → info                                                         */
/* ------------------------------------------------------------------ */

function renderDrug(key) {
    const d = D.drugs[key];
    if (!d) return;
    const out = $("drugOut");
    out.textContent = "";

    const count = document.createElement("div");
    count.className = "mt-count";
    count.textContent = "PROFILE // " + d.name.toUpperCase() + (d.rx ? " — PRESCRIPTION" : " — OTC");
    out.appendChild(count);

    const card = document.createElement("div");
    card.className = "mt-card";

    const title = document.createElement("div");
    title.className = "mt-card-title";
    title.textContent = d.name;
    card.appendChild(title);

    const tagrow = document.createElement("div");
    tagrow.className = "mt-tagrow";
    tagrow.appendChild(tag(d.rx ? "PRESCRIPTION" : "OTC", d.rx ? "rx" : "otc"));
    tagrow.appendChild(tag(d.cls, "cat"));
    card.appendChild(tagrow);

    const info = document.createElement("div");
    info.className = "mt-sec";
    const ik = document.createElement("span");
    ik.className = "k";
    ik.textContent = "WHAT IT DOES // ";
    const iv = document.createElement("span");
    iv.className = "v";
    iv.textContent = d.info;
    info.appendChild(ik);
    info.appendChild(iv);
    card.appendChild(info);

    const treats = document.createElement("div");
    treats.className = "mt-sec";
    const tk = document.createElement("span");
    tk.className = "k";
    tk.textContent = "USED FOR // click a symptom to flip back";
    treats.appendChild(tk);
    const trow = document.createElement("div");
    trow.className = "mt-tagrow";
    for (const symKey of d.treats) {
        const s = D.symptoms[symKey];
        if (!s) continue;
        trow.appendChild(tag(s.label, "cat", () => {
            renderSymptom(symKey);
            showTab("sym");
        }));
    }
    treats.appendChild(trow);
    card.appendChild(treats);

    const caut = document.createElement("div");
    caut.className = "mt-sec caution";
    const ck = document.createElement("span");
    ck.className = "k";
    ck.textContent = "KEY CAUTION // ";
    const cv = document.createElement("span");
    cv.className = "v";
    cv.textContent = d.caution;
    caut.appendChild(ck);
    caut.appendChild(cv);
    card.appendChild(caut);

    out.appendChild(card);

    const disc = document.createElement("div");
    disc.className = "mt-disclaimer";
    disc.textContent = DISCLAIMER;
    out.appendChild(disc);

    $("drugSearch").value = d.name;
    $("stInfo").textContent = d.name + " — " + d.treats.length + " indication(s)";
}

/* ------------------------------------------------------------------ */
/* Autocomplete                                                        */
/* ------------------------------------------------------------------ */

function fuzzyScore(term, text) {
    term = term.toLowerCase();
    text = text.toLowerCase();
    if (text === term) return 1000;
    if (text.startsWith(term)) return 900 - text.length;
    if (text.includes(term)) return 800 - text.length;
    // subsequence match
    let ti = 0;
    for (const ch of term) {
        const idx = text.indexOf(ch, ti);
        if (idx === -1) return -1;
        ti = idx + 1;
    }
    return 500 - text.length;
}

function buildSuggestions(term, kind) {
    const results = [];
    if (kind === "sym") {
        for (const [key, s] of Object.entries(D.symptoms)) {
            const sc = fuzzyScore(term, s.label);
            if (sc >= 0) results.push({ key, label: s.label, cat: D.categories[s.cat] || s.cat, score: sc });
        }
    } else {
        for (const [key, d] of Object.entries(D.drugs)) {
            const sc = Math.max(fuzzyScore(term, d.name), fuzzyScore(term, key));
            if (sc >= 0) results.push({ key, label: d.name, cat: d.rx ? "RX" : "OTC", score: sc });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 8);
}

function attachSugg(inputId, suggId, kind, onPick) {
    const input = $(inputId);
    const sugg = $(suggId);
    let sel = -1;

    const close = () => { sugg.hidden = true; sugg.textContent = ""; sel = -1; };

    const render = (items) => {
        sugg.textContent = "";
        if (!items.length) {
            const e = document.createElement("div");
            e.className = "sugg-empty";
            e.textContent = "no match — try another spelling";
            sugg.appendChild(e);
            sugg.hidden = false;
            return;
        }
        items.forEach((it, i) => {
            const e = document.createElement("div");
            e.className = "sugg-item" + (i === sel ? " sel" : "");
            e.textContent = it.label;
            const c = document.createElement("span");
            c.className = "s-cat";
            c.textContent = it.cat;
            e.appendChild(c);
            e.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                onPick(it);
                close();
            });
            sugg.appendChild(e);
        });
        sugg.hidden = false;
    };

    input.addEventListener("input", () => {
        const term = input.value.trim();
        sel = -1;
        if (term.length < 2) { close(); return; }
        render(buildSuggestions(term, kind));
    });

    input.addEventListener("keydown", (e) => {
        const items = buildSuggestions(input.value.trim(), kind);
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!sugg.hidden && items.length) { sel = (sel + 1) % items.length; render(items); }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!sugg.hidden && items.length) { sel = (sel - 1 + items.length) % items.length; render(items); }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (!sugg.hidden && sel >= 0 && items[sel]) { onPick(items[sel]); close(); }
            else if (items.length && items[0]) { onPick(items[0]); close(); }
        } else if (e.key === "Escape") {
            close();
        }
    });

    input.addEventListener("blur", () => setTimeout(close, 150));
    return close;
}

/* ------------------------------------------------------------------ */
/* Category chips + drug quick picks                                   */
/* ------------------------------------------------------------------ */

function buildChips() {
    const row = $("symCats");
    row.textContent = "";
    for (const [key, label] of Object.entries(D.categories)) {
        const c = document.createElement("button");
        c.type = "button";
        c.className = "chip";
        c.textContent = label;
        c.addEventListener("click", () => {
            row.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
            c.classList.add("on");
            showCategory(key);
        });
        row.appendChild(c);
    }

    // quick picks for the drug tab's left panel
    const quick = ["ibuprofen", "acetaminophen", "cetirizine", "omeprazole",
        "metformin", "albuterol", "lisinopril", "sertraline"];
    const qrow = $("drugQuick");
    qrow.textContent = "";
    for (const key of quick) {
        const d = D.drugs[key];
        if (!d) continue;
        const c = document.createElement("button");
        c.type = "button";
        c.className = "chip";
        c.textContent = d.name;
        c.addEventListener("click", () => renderDrug(key));
        qrow.appendChild(c);
    }
}

/* ------------------------------------------------------------------ */
/* PLAN: patient symptoms + clinic stock                               */
/* ------------------------------------------------------------------ */

const STOCK_KEY = "medterm_stock_v1";
let planSym = [];   // selected symptom keys

function stockLoad() {
    // null = never configured → assume all OTC in stock
    try {
        const raw = localStorage.getItem(STOCK_KEY);
        if (raw === null) return null;
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return null;
    }
}

function stockSave(set) {
    try {
        localStorage.setItem(STOCK_KEY, JSON.stringify([...set]));
    } catch { /* private mode — stock just won't persist */ }
}

function inStock(dk, stock) {
    if (stock === null) return !D.drugs[dk].rx;      // assume OTC shelf
    return stock.has(dk);
}

function stockMeta() {
    const stock = stockLoad();
    if (stock === null) return "stock not set — assuming all OTC available";
    return `stocked ${stock.size} of ${Object.keys(D.drugs).length}`;
}

function renderStockList(filter) {
    const list = $("stockList");
    const stock = stockLoad();
    const f = (filter || "").trim().toLowerCase();
    list.textContent = "";
    const keys = Object.keys(D.drugs).sort((a, b) => D.drugs[a].name.localeCompare(D.drugs[b].name));
    let shown = 0;
    for (const dk of keys) {
        const d = D.drugs[dk];
        if (f && !(d.name.toLowerCase().includes(f) || dk.includes(f))) continue;
        shown++;
        const row = document.createElement("label");
        row.className = "stock-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = stock !== null && stock.has(dk);
        cb.addEventListener("change", () => {
            const cur = stockLoad();
            const s = cur === null ? new Set() : cur;   // ticking always makes it explicit
            if (cb.checked) s.add(dk); else s.delete(dk);
            stockSave(s);
            $("stockMeta").textContent = stockMeta();
        });
        const name = document.createElement("span");
        name.className = "sname";
        name.textContent = d.name;
        const badge = document.createElement("span");
        badge.className = "sbadge";
        badge.textContent = d.rx ? "RX" : "OTC";
        row.appendChild(cb);
        row.appendChild(name);
        row.appendChild(badge);
        list.appendChild(row);
    }
    if (shown === 0) {
        const empty = document.createElement("div");
        empty.className = "sugg-empty";
        empty.textContent = "no drugs match the filter";
        list.appendChild(empty);
    }
    $("stockMeta").textContent = stockMeta();
}

function renderPlanSel() {
    const row = $("planSel");
    row.textContent = "";
    for (const key of planSym) {
        const s = D.symptoms[key];
        if (!s) continue;
        const c = document.createElement("button");
        c.type = "button";
        c.className = "chip";
        const name = document.createElement("span");
        name.textContent = s.label;
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "✕";
        c.appendChild(name);
        c.appendChild(x);
        c.title = "Remove " + s.label;
        c.addEventListener("click", () => {
            planSym = planSym.filter((k) => k !== key);
            renderPlanSel();
        });
        row.appendChild(c);
    }
}

function addPlanSymptom(key) {
    if (!D.symptoms[key] || planSym.includes(key)) return;
    planSym.push(key);
    renderPlanSel();
}

/* ------------------------------------------------------------------ */
/* PLAN engine                                                         */
/* ------------------------------------------------------------------ */

function planFor(symKeys) {
    const syms = symKeys.filter((k) => D.symptoms[k]);
    const stock = stockLoad();

    const cands = [];
    for (const sk of syms) {
        for (const dk of D.symptoms[sk].drugs) {
            if (cands.some((c) => c.dk === dk)) continue;
            const drug = D.drugs[dk];
            if (!drug) continue;
            const covered = syms.filter((s) => drug.treats.includes(s));
            const conflicts = syms
                .filter((s) => (drug.avoidSym || {})[s])
                .map((s) => ({ sym: s, reason: drug.avoidSym[s] }));
            cands.push({ dk, drug, covered, conflicts });
        }
    }

    const usable = cands.filter((c) => c.conflicts.length === 0);
    const avoids = cands.filter((c) => c.conflicts.length > 0);

    // Greedy cover: fewest drugs, most symptoms each, stocked + OTC preferred.
    const picked = [];
    const remaining = new Set(syms);
    while (remaining.size) {
        let best = null;
        for (const u of usable) {
            if (picked.some((p) => p.dk === u.dk)) continue;
            const cov = u.covered.filter((s) => remaining.has(s));
            if (!cov.length) continue;
            const score = cov.length * 1000
                + (inStock(u.dk, stock) ? 200 : 0)
                + (u.drug.rx ? -50 : 0);
            if (!best || score > best.score) best = { ...u, score };
        }
        if (!best) break;
        picked.push(best);
        best.covered.forEach((s) => remaining.delete(s));
    }

    const gaps = syms.filter((s) => !picked.some((p) => p.covered.includes(s)));
    const pickedDks = new Set(picked.map((p) => p.dk));
    const others = usable
        .filter((u) => !pickedDks.has(u.dk))
        .map((u) => ({ ...u, stocked: inStock(u.dk, stock) }))
        .sort((a, b) => b.covered.length - a.covered.length || Number(b.stocked) - Number(a.stocked));

    const single = picked.length === 1 && picked[0].covered.length === syms.length ? picked[0] : null;

    return {
        syms,
        picked: picked.map((p) => ({ ...p, stocked: inStock(p.dk, stock) })),
        single,
        others: others.slice(0, 6),
        avoids,
        gaps,
        stockExplicit: stock !== null,
    };
}

function renderPlan() {
    const out = $("planOut");
    out.textContent = "";
    if (!planSym.length) {
        const p = document.createElement("div");
        p.className = "mt-placeholder";
        p.innerHTML = "";
        const t = document.createElement("p");
        t.className = "mt-ph-title";
        t.textContent = "[ PATIENT PLAN ]";
        const s1 = document.createElement("p");
        s1.className = "faint";
        s1.textContent = "Add at least one symptom on the left — e.g. 'stomach pain' then 'headache'.";
        p.appendChild(t);
        p.appendChild(s1);
        out.appendChild(p);
        return;
    }

    const res = planFor(planSym);
    const badge = (text, cls) => {
        const b = document.createElement("span");
        b.className = "plan-badge " + cls;
        b.textContent = text;
        return b;
    };
    const rowEl = (name, detailEls, extraCls) => {
        const r = document.createElement("div");
        r.className = "plan-row" + (extraCls ? " " + extraCls : "");
        const n = document.createElement("span");
        n.className = "pname";
        n.textContent = name;
        r.appendChild(n);
        const d = document.createElement("span");
        d.className = "pdetail";
        for (const e of detailEls) d.appendChild(e);
        r.appendChild(d);
        return r;
    };
    const sec = (title) => {
        const t = document.createElement("div");
        t.className = "plan-sec-title";
        t.textContent = title;
        out.appendChild(t);
    };
    const txt = (text, cls) => {
        const s = document.createElement("span");
        if (cls) s.className = cls;
        s.textContent = text;
        return s;
    };

    const count = document.createElement("div");
    count.className = "mt-count";
    count.textContent = "PLAN // " + res.syms.map((s) => D.symptoms[s].label).join(" + ");
    out.appendChild(count);

    if (!res.stockExplicit) {
        const note = document.createElement("div");
        note.className = "plan-callout warn";
        note.textContent = "⚠ Clinic stock is not set — the plan assumes every OTC item is on the shelf. " +
            "Tick the stock list on the left to plan around what the clinic actually keeps.";
        out.appendChild(note);
    }

    sec("RECOMMENDED — BEST COVERAGE");
    for (const p of res.picked) {
        const coveredNames = p.covered.map((s) => D.symptoms[s].label);
        const badges = [];
        if (p.drug.rx) badges.push(badge("RX", "rx"));
        badges.push(p.stocked ? badge("✓ IN STOCK", "ok") : badge("✗ NOT STOCKED", "no"));
        const det = [txt("covers " + coveredNames.join(" + ") + ". "), ...badges];
        const r = rowEl(p.drug.name, det);
        r.style.cursor = "pointer";
        r.title = "Open drug profile";
        r.addEventListener("click", () => {
            $("drugSearch").value = p.drug.name;
            renderDrug(p.dk);
            showTab("drug");
        });
        out.appendChild(r);
    }

    if (res.single) {
        const callout = document.createElement("div");
        callout.className = "plan-callout";
        callout.textContent = "★ Single-agent option — " + res.single.drug.name +
            " alone covers every listed symptom. Fewest items to stock and dispense.";
        out.appendChild(callout);
    }

    if (res.others.length) {
        sec("ALTERNATIVES — ALSO USABLE");
        for (const o of res.others) {
            const coveredNames = o.covered.map((s) => D.symptoms[s].label);
            const badges = [];
            if (o.drug.rx) badges.push(badge("RX", "rx"));
            badges.push(o.stocked ? badge("✓ IN STOCK", "ok") : badge("✗ NOT STOCKED", "no"));
            out.appendChild(rowEl(o.drug.name, [txt("covers " + coveredNames.join(" + ") + ". "), ...badges]));
        }
    }

    if (res.avoids.length) {
        sec("AVOID HERE — CONFLICT WITH LISTED SYMPTOMS");
        const w = document.createElement("div");
        w.className = "plan-callout warn";
        w.textContent = "These drugs are common for one listed symptom but can worsen another — do not offer them in this case:";
        out.appendChild(w);
        for (const a of res.avoids) {
            const reason = a.conflicts.map((c) =>
                D.symptoms[c.sym].label + ": " + c.reason).join(" ");
            out.appendChild(rowEl(a.drug.name, [txt("for " + a.covered.map((s) => D.symptoms[s].label).join(" + ") + ". ", "faint"), txt(reason, "plan-reason")], "plan-avoid"));
        }
    }

    if (res.gaps.length) {
        const c = document.createElement("div");
        c.className = "plan-callout warn";
        c.textContent = "☁ No suitable in-plan drug for: " +
            res.gaps.map((s) => D.symptoms[s].label).join(", ") +
            " — confirm with a pharmacist or refer onward.";
        out.appendChild(c);
    }

    const disc = document.createElement("div");
    disc.className = "mt-disclaimer";
    disc.textContent = DISCLAIMER;
    out.appendChild(disc);
    $("stInfo").textContent = "plan for " + planSym.length + " symptom(s) · " + res.picked.length + " recommended item(s)";
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

$("btnTabSym").addEventListener("click", () => showTab("sym"));
$("btnTabDrug").addEventListener("click", () => showTab("drug"));
$("btnTabPlan").addEventListener("click", () => showTab("plan"));

attachSugg("symSearch", "symSugg", "sym", (it) => renderSymptom(it.key));
attachSugg("drugSearch", "drugSugg", "drug", (it) => renderDrug(it.key));
attachSugg("planSearch", "planSugg", "sym", (it) => {
    addPlanSymptom(it.key);
    $("planSearch").value = "";
});

$("btnPlanRun").addEventListener("click", renderPlan);
$("btnPlanClear").addEventListener("click", () => {
    planSym = [];
    renderPlanSel();
    $("planOut").textContent = "";
    $("stInfo").textContent = TAB_INFO.plan;
});

$("stockFilter").addEventListener("input", (e) => renderStockList(e.target.value));
$("btnStockAll").addEventListener("click", () => {
    const s = new Set();
    for (const [dk, d] of Object.entries(D.drugs)) if (!d.rx) s.add(dk);
    stockSave(s);
    renderStockList($("stockFilter").value);
});
$("btnStockClear").addEventListener("click", () => {
    stockSave(new Set());
    renderStockList($("stockFilter").value);
});

/* ------------------------------------------------------------------ */
/* Light / dark mode                                                   */
/* ------------------------------------------------------------------ */

const MODE_KEY = "medterm_mode";

function applyMode(mode) {
    document.body.dataset.mode = mode;
    $("btnMode").textContent = mode === "light" ? "☾ DARK" : "☀ LIGHT";
    try {
        localStorage.setItem(MODE_KEY, mode);
    } catch { /* private mode — preference just won't persist */ }
}

function initialMode() {
    try {
        const saved = localStorage.getItem(MODE_KEY);
        if (saved === "light" || saved === "dark") return saved;
    } catch { /* ignore */ }
    // no saved preference → follow the OS
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return "dark";
}

/* ------------------------------------------------------------------ */
/* Clock + init                                                        */
/* ------------------------------------------------------------------ */

setInterval(() => {
    const d = new Date();
    $("stClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

window.addEventListener("DOMContentLoaded", () => {
    buildChips();
    renderPlanSel();
    renderStockList("");
    showTab("sym");
    applyMode(initialMode());
});

$("btnMode").addEventListener("click", () => {
    const next = document.body.dataset.mode === "light" ? "dark" : "light";
    applyMode(next);
});

})();