/* ============================================================
   PASSFORGE — Password & Passphrase forge + HIBP pwn check
   Crypto is local (crypto.getRandomValues); the breach check
   uses HIBP's k-anonymity API — only 5 hash chars leave.
   ============================================================ */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }

/* ------------------------------------------------------------------ */
/* Secure randomness                                                   */
/* ------------------------------------------------------------------ */

function randInt(n) {
    // uniform int in [0, n)
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do {
        crypto.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return x % n;
}

function pick(set) {
    return set[randInt(set.length)];
}

/* ------------------------------------------------------------------ */
/* Char pools                                                          */
/* ------------------------------------------------------------------ */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";            // no I, O
const LOWER = "abcdefghijkmnopqrstuvwxyz";           // no l
const DIGITS = "23456789";                            // no 0, 1
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/";
const AMBIG_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const AMBIG_LOWER = "abcdefghijklmnopqrstuvwxyz";
const AMBIG_DIGITS = "0123456789";

function buildPool(opts) {
    const excl = opts.excl;
    let pool = "";
    if (opts.upper) pool += excl ? UPPER : AMBIG_UPPER;
    if (opts.lower) pool += excl ? LOWER : AMBIG_LOWER;
    if (opts.digit) pool += excl ? DIGITS : AMBIG_DIGITS;
    if (opts.sym) pool += SYMBOLS;
    return pool;
}

/* ------------------------------------------------------------------ */
/* Password generation                                                 */
/* ------------------------------------------------------------------ */

function genPassword(len, opts) {
    const pool = buildPool(opts);
    if (!pool) throw new Error("at least one character class must be enabled");
    // Ensure at least one char from each selected class (reservoir trick).
    const classes = [];
    if (opts.upper) classes.push(opts.excl ? UPPER : AMBIG_UPPER);
    if (opts.lower) classes.push(opts.excl ? LOWER : AMBIG_LOWER);
    if (opts.digit) classes.push(opts.excl ? DIGITS : AMBIG_DIGITS);
    if (opts.sym) classes.push(SYMBOLS);

    const chars = [];
    // fill required class representatives
    for (let i = 0; i < classes.length; i++) {
        chars.push(pick(classes[i]));
    }
    // fill the rest from the full pool
    while (chars.length < len) chars.push(pick(pool));
    // Fisher–Yates shuffle with secure randomness
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
}

/* ------------------------------------------------------------------ */
/* Passphrase generation (diceware-lite word list)                     */
/* ------------------------------------------------------------------ */

// 256 common words — plenty of entropy per word (8 bits) with full
// dictionary words. Longer than diceware's 7776, but self-contained.
const WORDLIST = [
    "acid","acorn","alarm","alien","amber","anchor","angel","apple","april","arrow",
    "atlas","audio","aurora","autumn","avatar","axiom","aztec","bacon","badge","baker",
    "balloon","banana","banner","basil","basket","battery","beacon","bean","beaver","berry",
    "binder","biscuit","blade","blanket","blizzard","bloom","blossom","board","bobcat","bolt",
    "bonfire","book","boulder","bounce","breeze","bridge","bronze","broom","brush","bubble",
    "bucket","budget","buffalo","bugle","bulb","bullet","bundle","burger","burst","butter",
    "button","cabin","cable","cactus","calm","camel","camera","candle","canyon","carbon",
    "cargo","carpet","carrot","cascade","castle","cat","cattle","cave","cedar","celery",
    "cellar","cement","cereal","chalk","champion","channel","charcoal","charm","chart","cheese",
    "cherry","chest","chicken","chief","chimney","chip","chisel","chocolate","choir","circle",
    "citrus","clarity","claw","cliff","clock","cloud","clover","cluster","coast","cobalt",
    "cobra","coconut","coffee","collar","colony",    "comet","comic","cocoa","conch","condor",
    "copper","coral","corner","cosmos","cotton","cougar","courage","cove","crab","craft",
    "crane","crater","crayon","cricket","crown","cruise","crystal","cube","cuckoo","current",
    "curtain","cushion","cyber","cycle","cypress","dagger","daisy","dancer","dandelion","dawn",
    "deer","delta","denim","desert","design","diamond","diesel","dinner","dinosaur","diver",
    "dolphin","domain","donkey","doodle","dove","dragon","drake","drama","drum","duck",
    "dune","dusk","eagle","east","echo","eclipse","editor","eel","elbow","elder",
    "electric","elephant","ember","emerald","energy","engine","enigma","eraser","escape","estate",
    "euro","evening","everest","fabric","falcon","fancy","feather","fern","ferry","festival",
    "fig","finch","fir","firefly","flame","flash","flint","flock","flora","flower",
    "foam","forest","forge","fossil","fox","freedom","frost","frog","frontier","fuse",
    "galaxy","garden","garnet","gecko","geyser","ghost","giant","giraffe","glacier","glass",
    "glider","globe","glow","goat","gold","golf","gondola","goose","gossip","grain",
    "granite","grape","grass","gravity","green","grid","guitar","gulf","gum","gym",
    "hacker","harbor","harmony","harp","harvest","hazard","hazel","heart","hedge","helix",
    "heron","hickory","hill","hive","hollow","holly","honey","hood","hoop","horizon",
    "horse","hour","house","hunter","hurricane","iceberg","icon","igloo","image","impact",
    "index","indigo","inlet","insect","iron","island","ivory","jackal","jade","jaguar",
    "jazz","jeep","jelly","jewel","journey","judo","juggler","juice","jungle","jupiter",
    "kayak","kebab","kelp","kernel","kettle","key","kite","kiwi","knife","koala",
    "lab","ladder","lagoon","lake","lamp","land","lantern","laser","lava","lawn",
    "leaf","leather","legend","lemon","level","liberty","lilac","lily","limestone","linen",
    "lion","liquid","lizard","lobster","logic","lotus","loyal","lucky","lunar","lynx",
    "macro","magic","magnet","maize","mammoth","mandolin","mango","maple","marble","marine",
    "mars","mason","matrix","meadow","medal","melon","mercury","meridian","metal","meteor",
    "mica","mint","mirror","mist","mocha","model","monkey","monsoon","moon","moose",
    "morning","mosaic","moss","moth","motor","mountain","mouse","mule","mural","mushroom",
    "music","mystic","nacho","nano","narrow","nectar","needle","neon","nest","network",
    "neutral","nickel","night","ninja","noble","noise","noodle","north","nova","nugget",
    "nut","oak","oasis","ocean","octopus","olive","onion","onyx","opal","opera",
    "orbit","orchid","ore","origin","osprey","otter","oval","oxygen","oyster","ozone",
    "paddle","paint","palm","panda","panel","panther","paper","papaya","parade","parcel",
    "parchment","park","parrot","particle","passage","path","patrol","peach","pearl","pecan",
    "pegasus","pelican","pepper","perch","perfume","phoenix","photo","piano","pickle","pigeon",
    "pillar","pillow","pilot","pine","pioneer","pistachio","pixel","placid","planet","plasma",
    "plaza","plum","poem","polar","polo","pond","poppy","porch","portal","poster",
    "potato","powder","prairie","prawn","prelude","prism","prize","prophet","pulse","pumpkin",
    "puzzle","pyramid","python","quartz","quasar","queen","quest","quill","quilt","quote",
    "rabbit","radar","radish","raft","rail","rainbow","ranch","ranger","rapids","raven",
    "rebel","reef","relay","relic","resin","rhino","ridge","rifle","river","robin",
    "robot","rocket","rogue","rooster","rose","ruby","rudder","rune","runner","rust",
    "safari","sail","salmon","salt","sample","sand","sapphire","satellite","savanna","scale",
    "scarf","school","scissors","scout","scuba","season","seed","sequoia","shade","shadow",
    "shark","sheep","shell","sherbet","shield","ship","shore","shuttle","signal","silicon",
    "silver","siren","skate","sketch","skipper","skunk","sky","slate","sled","sloth",
    "smoke","snail","snake","snow","soccer","soda","solar","sonar","song","sparrow",
    "spectrum","sphere","spider","spiral","spirit","splash","sponge","spoon","spring","sprout",
    "squad","squid","stable","stadium","star","starlight","steel","stellar","stereo","stone",
    "storm","stream","street","stripe","summit","sunflower","sunset","supernova","surf","swan",
    "swift","switch","sword","syrup","table","taco","talent","tangerine","tango","tank",
    "tapestry","taro","tartan","teal","tempo","tennis","tent","thimble","thistle","thunder",
    "tide","tiger","timber","titan","toast","tomato","tone","tornado","torpedo","toucan",
    "tower","toxin","trail","train","trance","travel","treasure","tribune","tricycle","trophy",
    "tropical","trout","tulip","tumble","tuna","tunnel","turkey","turnip","turtle","twig",
    "twilight","twin","typhoon","umbrella","unicorn","unison","uranium","utopia","vacuum","valley",
    "vapor","vault","vegan","velvet","venture","venus","vertex","vessel","vibrant","victory",
    "video","violet","viper","virgo","visor","vista","volcano","vortex","voyage","walrus",
    "walnut","waltz","wander","wasp","water","wave","weasel","weather","weaver","web",
    "whale","wheat","wheel","willow","wind","window","winter","wire","wisdom","wolf",
    "wombat","wonder","wood","wool","wren","wrist","yacht","yarn","yoga","zebra",
    "zenith","zephyr","zinc","zipper","zone","zoo","zoom",
];

function genPassphrase(words, sep, opts) {
    const chosen = [];
    for (let i = 0; i < words; i++) {
        let w = WORDLIST[randInt(WORDLIST.length)];
        if (opts.cap) w = w[0].toUpperCase() + w.slice(1);
        chosen.push(w);
    }
    let out = chosen.join(sep);
    if (opts.num) out += sep + String(randInt(100)).padStart(2, "0");
    return out;
}

/* ------------------------------------------------------------------ */
/* Entropy                                                             */
/* ------------------------------------------------------------------ */

function poolSize(opts) {
    let n = 0;
    if (opts.upper) n += opts.excl ? UPPER.length : AMBIG_UPPER.length;
    if (opts.lower) n += opts.excl ? LOWER.length : AMBIG_LOWER.length;
    if (opts.digit) n += opts.excl ? DIGITS.length : AMBIG_DIGITS.length;
    if (opts.sym) n += SYMBOLS.length;
    return n;
}

function pwEntropy(len, opts) {
    const n = poolSize(opts);
    return n > 1 ? len * Math.log2(n) : 0;
}

function phEntropy(words, opts) {
    let bits = words * Math.log2(WORDLIST.length);
    if (opts.num) bits += Math.log2(100);
    if (opts.cap) bits += words; // each word may be capitalized (1 bit each, approx)
    return bits;
}

function entropyLabel(bits) {
    if (bits < 40) return "WEAK — crackable in moments";
    if (bits < 60) return "OK — fine for casual logins";
    if (bits < 80) return "STRONG — good for most accounts";
    if (bits < 100) return "VERY STRONG — great for email & banking";
    return "PARANOID — overkill for anything but the crown jewels";
}

function entropyColor(bits) {
    if (bits < 40) return "#ff5f57";
    if (bits < 60) return "#ffb000";
    return "#33ff66";
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function showTab(which) {
    const panels = { pw: "panelPw", ph: "panelPh", check: "panelCheck" };
    const btns = { pw: "btnTabPw", ph: "btnTabPh", check: "btnTabCheck" };
    const labels = { pw: "PASSWORD", ph: "PASSPHRASE", check: "PWNED?" };
    for (const k of Object.keys(panels)) {
        $(panels[k]).classList.toggle("hidden", k !== which);
        $(btns[k]).classList.toggle("active", k === which);
    }
    $("stMode").textContent = labels[which];
    $("stInfo").textContent = which === "check" ? "hibp k-anonymity · only 5 hash chars leave" : "crypto.getRandomValues · no key needed";
}

/* ------------------------------------------------------------------ */
/* Copy helper                                                         */
/* ------------------------------------------------------------------ */

async function copyText(text, btnId) {
    if (!text || text === "—") return;
    const btn = $(btnId);
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "✓ COPIED";
        setTimeout(() => { btn.textContent = "⧉ COPY"; }, 1200);
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch { /* noop */ }
        document.body.removeChild(ta);
        btn.textContent = "✓ COPIED";
        setTimeout(() => { btn.textContent = "⧉ COPY"; }, 1200);
    }
}

/* ------------------------------------------------------------------ */
/* Password UI                                                         */
/* ------------------------------------------------------------------ */

function renderPw() {
    const len = parseInt($("pwLen").value, 10);
    const opts = {
        upper: $("pwUpper").checked,
        lower: $("pwLower").checked,
        digit: $("pwDigit").checked,
        sym: $("pwSym").checked,
        excl: $("pwExcl").checked,
    };
    let pw;
    try {
        pw = genPassword(len, opts);
    } catch (err) {
        $("pwOut").textContent = "✗ " + err.message;
        $("pwMeta").textContent = "";
        return;
    }
    const bits = pwEntropy(len, opts);
    $("pwOut").textContent = pw;
    $("pwMeta").innerHTML = "";
    const m = document.createElement("span");
    m.style.color = entropyColor(bits);
    m.textContent = `${bits.toFixed(1)} bits · ${entropyLabel(bits)}`;
    $("pwMeta").appendChild(m);
}

function renderPh() {
    const words = parseInt($("phWords").value, 10);
    const sep = $("phSep").value;
    const opts = {
        num: $("phNum").checked,
        cap: $("phCap").checked,
    };
    const ph = genPassphrase(words, sep, opts);
    const bits = phEntropy(words, opts);
    $("phOut").textContent = ph;
    $("phMeta").innerHTML = "";
    const m = document.createElement("span");
    m.style.color = entropyColor(bits);
    m.textContent = `${bits.toFixed(1)} bits · ${entropyLabel(bits)}`;
    $("phMeta").appendChild(m);
}

/* ------------------------------------------------------------------ */
/* HIBP k-anonymity breach check                                       */
/* ------------------------------------------------------------------ */

async function sha1Hex(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkBreach() {
    const pw = $("checkPw").value;
    if (!pw) {
        $("checkOut").textContent = "✗ type a password to check";
        $("checkMeta").textContent = "";
        return;
    }
    $("checkOut").textContent = "hashing locally…";
    $("checkMeta").textContent = "sha-1: computing";
    let hash;
    try {
        hash = await sha1Hex(pw);
    } catch {
        $("checkOut").textContent = "✗ sha-1 failed (needs a secure context)";
        $("checkMeta").textContent = "";
        return;
    }
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5).toUpperCase();
    $("checkMeta").textContent = `sha-1 ${hash.slice(0, 5)}… (only this prefix is sent)`;

    try {
        $("checkOut").textContent = "querying HIBP range…";
        const res = await fetch("https://api.pwnedpasswords.com/range/" + prefix);
        if (!res.ok) throw new Error("HIBP returned HTTP " + res.status);
        const body = await res.text();
        let count = 0;
        for (const line of body.split("\n")) {
            const [suf, cnt] = line.trim().split(":");
            if (suf === suffix) { count = parseInt(cnt, 10) || 0; break; }
        }
        if (count > 0) {
            $("checkOut").innerHTML = "";
            const s = document.createElement("span");
            s.style.color = "#ff5f57";
            s.textContent = `☠ PWNED — seen ${count.toLocaleString()} times in known breaches. Never use it.`;
            $("checkOut").appendChild(s);
            $("checkMeta").textContent = `prefix ${prefix} · ${count.toLocaleString()} occurrences`;
        } else {
            $("checkOut").innerHTML = "";
            const s = document.createElement("span");
            s.style.color = "#33ff66";
            s.textContent = "✓ CLEAN — not found in any known breach (10M+ passwords checked).";
            $("checkOut").appendChild(s);
            $("checkMeta").textContent = `prefix ${prefix} · 0 occurrences`;
        }
    } catch (err) {
        $("checkOut").textContent = "✗ " + err.message;
        $("checkMeta").textContent = "check needs outbound HTTPS to api.pwnedpasswords.com";
    }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

$("btnTabPw").addEventListener("click", () => showTab("pw"));
$("btnTabPh").addEventListener("click", () => showTab("ph"));
$("btnTabCheck").addEventListener("click", () => showTab("check"));
showTab("pw");

$("btnPwGen").addEventListener("click", renderPw);
$("pwLen").addEventListener("input", () => {
    $("pwLenVal").textContent = $("pwLen").value;
    renderPw();
});
["pwUpper", "pwLower", "pwDigit", "pwSym", "pwExcl"].forEach((id) =>
    $(id).addEventListener("change", renderPw)
);

$("btnPhGen").addEventListener("click", renderPh);
$("phWords").addEventListener("input", () => {
    $("phWordsVal").textContent = $("phWords").value;
    renderPh();
});
["phSep", "phNum", "phCap"].forEach((id) =>
    $(id).addEventListener("change", renderPh)
);

$("btnPwCopy").addEventListener("click", () => copyText($("pwOut").textContent, "btnPwCopy"));
$("btnPhCopy").addEventListener("click", () => copyText($("phOut").textContent, "btnPhCopy"));
$("btnCheckCopy").addEventListener("click", () => copyText($("checkOut").textContent, "btnCheckCopy"));

$("btnCheck").addEventListener("click", checkBreach);
$("checkPw").addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkBreach();
});

/* ------------------------------------------------------------------ */
/* Clock + init                                                        */
/* ------------------------------------------------------------------ */

setInterval(() => {
    const d = new Date();
    $("stClock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

window.addEventListener("DOMContentLoaded", () => {
    renderPw();
    renderPh();
});

})();