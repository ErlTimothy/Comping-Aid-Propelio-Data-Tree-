// Propelio: price per acre under each comps card, and on the open listing
const SCAN_MS = 2000;

const cardDone = new WeakSet();        // LP elements already labeled
const cardAcresCache = new WeakMap();  // card -> acres
const modalDone = new WeakSet();       // open-listing prices already labeled
let running = false;

function text(el) {
  return (el.textContent || "").trim();
}

// Parses "LP $2.45m", "LP $129.90k", or "SP $81k" -> number
function parseMoney(str, label) {
  const re = new RegExp(label + "\\s*\\$\\s*([\\d,]*\\.?\\d+)\\s*([km]?)", "i");
  const m = str.match(re);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ""));
  const unit = m[2].toLowerCase();
  if (unit === "k") v *= 1000;
  if (unit === "m") v *= 1000000;
  return v;
}

// Finds the smallest elements whose text matches the regex (cheap: uses textContent, not innerText)
function findInnermost(regex) {
  const out = [];
  for (const el of document.querySelectorAll("p, span, div, td, li, b, strong")) {
    const t = text(el);
    if (t.length > 80 || !regex.test(t)) continue;
    let childMatch = false;
    for (const c of el.children) {
      if (regex.test(text(c))) { childMatch = true; break; }
    }
    if (!childMatch) out.push(el);
  }
  return out;
}

// Walks up from an element until it finds an ancestor containing a matching label
function findAncestorWithLabel(el, labelTest) {
  let node = el;
  for (let i = 0; i < 10 && node; i++) {
    const hasLabel = [...node.querySelectorAll("*")].some(
      c => c.children.length === 0 && labelTest(text(c))
    );
    if (hasLabel) return node;
    node = node.parentElement;
  }
  return null;
}

// Reads a card's status: Sold, Pending, For Sale, or Off Market
function findStatus(container) {
  for (const el of container.querySelectorAll("*")) {
    if (el.children.length) continue;
    const t = text(el);
    if (/^sold(\s*[-–].*)?$/i.test(t)) return "Sold";
    if (/^pending(\s*[-–].*)?$/i.test(t)) return "Pending";
    if (/^for sale(\s*[-–].*)?$/i.test(t)) return "For Sale";
    if (/^off market(\s*[-–].*)?$/i.test(t)) return "Off Market";
  }
  return "Unknown";
}

// Finds the acreage value under the "acre" header, matched by horizontal position
function findAcres(card) {
  const label = [...card.querySelectorAll("*")].find(
    c => c.children.length === 0 && text(c).toLowerCase() === "acre"
  );
  if (!label) return null;

  const lr = label.getBoundingClientRect();
  const labelCenter = (lr.left + lr.right) / 2;
  let best = null;
  let bestDist = Infinity;

  for (const el of card.querySelectorAll("*")) {
    if (el.children.length) continue;
    const t = text(el);
    if (!/^[\d,]*\.?\d+$/.test(t)) continue;

    const r = el.getBoundingClientRect();
    if (r.top <= lr.top || r.top - lr.top > 80) continue;

    const dist = Math.abs((r.left + r.right) / 2 - labelCenter);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }

  if (!best) return null;
  const acres = parseFloat(best.replace(/,/g, ""));
  return acres > 0 ? acres : null;
}

// Acreage is read once per card and cached
function getCardAcres(card) {
  if (cardAcresCache.has(card)) return cardAcresCache.get(card);
  const acres = findAcres(card);
  if (acres) cardAcresCache.set(card, acres);
  return acres;
}

// Single green line: "$3,240 / acre"
function makeLine(str) {
  const d = document.createElement("div");
  d.className = "ppa-card-line";
  d.textContent = str;
  Object.assign(d.style, {
    display: "inline-block",
    marginTop: "4px",
    padding: "2px 8px",
    borderRadius: "4px",
    background: "#1f7a4d",
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    fontSize: "12px",
    fontWeight: "700",
    whiteSpace: "nowrap"
  });
  return d;
}

// Places a node after an element, or after its parent if the element is inline
function insertAfterElement(el, node) {
  const display = getComputedStyle(el).display;
  const anchor = display.startsWith("inline") && el.parentElement ? el.parentElement : el;
  anchor.insertAdjacentElement("afterend", node);
  return anchor;
}

// ---------- Comps cards ----------

function runCards() {
  for (const priceEl of findInnermost(/LP\s*\$/i)) {
    if (cardDone.has(priceEl)) continue;

    const lp = parseMoney(text(priceEl), "LP");
    if (!lp) continue;

    const card = findAncestorWithLabel(priceEl, t => t.toLowerCase() === "acre");
    if (!card) continue;

    const acres = getCardAcres(card);
    if (!acres) continue; // acreage not loaded yet, try again on the next pass

    // Sold cards use the sold price when shown; everything else uses the list price
    let price = lp;
    let suffix = "";
    if (findStatus(card) === "Sold") {
      const sp = parseMoney(text(card), "SP");
      if (sp) {
        price = sp;
        suffix = " (sold)";
      }
    }

    const perAcre = Math.round(price / acres);
    const anchor = insertAfterElement(priceEl, makeLine(`$${perAcre.toLocaleString()} / acre${suffix}`));
    cardDone.add(priceEl);
    anchor.dataset.ppa = "1";
  }
}

// ---------- Open listing ----------

// Finds the large main price in the open listing, e.g. "$90,067"
function findModalPrice() {
  let best = null;
  let bestSize = 0;
  for (const el of document.querySelectorAll("span, div, p, h1, h2, h3, strong")) {
    if (el.children.length) continue;
    if (!/^\$\s*[\d,]+$/.test(text(el))) continue;
    const size = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (size > bestSize) {
      bestSize = size;
      best = el;
    }
  }
  return bestSize >= 20 ? best : null;
}

// Reads the value to the right of "Approx. Acres", or falls back to Lot SqFt / 43,560
function findModalAcres() {
  const label = [...document.querySelectorAll("body *")].find(
    el => el.children.length === 0 && /^approx\.?\s*acres$/i.test(text(el))
  );

  if (label) {
    const lr = label.getBoundingClientRect();
    const labelMid = (lr.top + lr.bottom) / 2;
    let best = null;
    let bestDist = Infinity;

    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length) continue;
      const t = text(el);
      if (!/^[\d,]*\.?\d+$/.test(t)) continue;

      const r = el.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      if (Math.abs(mid - labelMid) > 12) continue;
      if (r.left <= lr.right) continue;

      const dist = r.left - lr.right;
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }

    if (best) {
      const acres = parseFloat(best.replace(/,/g, ""));
      if (acres > 0) return acres;
    }
  }

  const sqftLabel = [...document.querySelectorAll("body *")].find(
    el => el.children.length === 0 && /^lot\s*sqft$/i.test(text(el))
  );
  if (sqftLabel) {
    const row = sqftLabel.parentElement;
    const valueLeaf = row && [...row.querySelectorAll("*")].find(
      el => el !== sqftLabel && el.children.length === 0 && /^[\d,]+$/.test(text(el))
    );
    if (valueLeaf) {
      const sqft = parseFloat(text(valueLeaf).replace(/,/g, ""));
      if (sqft > 0) return sqft / 43560;
    }
  }

  return null;
}

function runModal() {
  const priceEl = findModalPrice();
  if (!priceEl || modalDone.has(priceEl)) return;

  const acres = findModalAcres();
  if (!acres) return;

  const price = parseFloat(text(priceEl).replace(/[$,\s]/g, ""));
  if (!price) return;

  const container = findAncestorWithLabel(priceEl, t => /^(sold|pending|for sale|off market)$/i.test(t)) || priceEl.parentElement;
  const basis = findStatus(container) === "Sold" ? "sold price" : "list price";

  const perAcre = Math.round(price / acres);
  const badge = makeLine(`$${perAcre.toLocaleString()} / acre (${basis})`);
  badge.className = "ppa-modal-badge";
  badge.style.display = "block";
  badge.style.width = "fit-content";
  insertAfterElement(priceEl, badge);
  modalDone.add(priceEl);
}

// ---------- Run loop ----------

function safeRun(name, fn) {
  try {
    fn();
  } catch (e) {
    console.warn("PPA Propelio", name, e);
  }
}

// Runs on a fixed timer, never overlapping. No page observer, so our own changes can't re-trigger it.
function run() {
  if (running) return;
  running = true;
  try {
    safeRun("cards", runCards);
    safeRun("modal", runModal);
  } finally {
    running = false;
  }
}

setTimeout(() => {
  run();
  setInterval(run, SCAN_MS);
}, 1500);