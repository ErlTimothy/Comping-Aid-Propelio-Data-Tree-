const SQFT_PER_ACRE = 43560;
const EXACT_SQFT = /^([\d,]+(?:\.\d+)?)\s*sq\.?\s*ft\.?$/i;
const LOT_LABEL = /^lot\s*(area|size)$/i;
const done = new WeakSet();

function text(el) {
  return (el.innerText || el.textContent || "").trim();
}

// True if a "Lot Area" label sits directly above this value in the same column
function hasLotLabelAbove(valueEl) {
  const v = valueEl.getBoundingClientRect();
  const vx = (v.left + v.right) / 2;

  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length) continue;
    if (!LOT_LABEL.test(text(el))) continue;

    const l = el.getBoundingClientRect();
    const lx = (l.left + l.right) / 2;
    if (Math.abs(lx - vx) < 80 && v.top > l.top && v.top - l.top < 80) return true;
  }
  return false;
}

// Places a node after the value, or after its parent if the value is inline
function placeBelow(el, node) {
  const display = getComputedStyle(el).display;
  const anchor = display.startsWith("inline") && el.parentElement ? el.parentElement : el;
  anchor.insertAdjacentElement("afterend", node);
}

function makeAcresNode(acres) {
  const div = document.createElement("div");
  div.className = "ppa-acres";
  div.textContent = `${acres.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} acres`;
  Object.assign(div.style, {
    display: "block",
    marginTop: "2px",
    color: "#1f7a4d",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    fontWeight: "700"
  });
  return div;
}

function convertLotSizes() {
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length) continue;
    if (done.has(el)) continue;

    const m = text(el).match(EXACT_SQFT);
    if (!m) continue;

    const next = el.nextElementSibling;
    if (next && next.classList.contains("ppa-acres")) {
      done.add(el);
      continue;
    }

    if (!hasLotLabelAbove(el)) continue;

    const sqft = parseFloat(m[1].replace(/,/g, ""));
    if (!sqft) continue;

    placeBelow(el, makeAcresNode(sqft / SQFT_PER_ACRE));
    done.add(el);
  }
}

function safeRun() {
  try {
    convertLotSizes();
  } catch (e) {
    console.warn("PPA DataTree", e);
  }
}

// Re-check when the page changes, ignoring changes made only by our own acreage lines
let timer = null;
const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => {
    const added = [...m.addedNodes];
    return added.length === 0 || !added.every(n => n.nodeType === 1 && n.classList.contains("ppa-acres"));
  });
  if (!relevant) return;

  clearTimeout(timer);
  timer = setTimeout(safeRun, 1000);
});

setTimeout(() => {
  safeRun();
  observer.observe(document.body, { childList: true, subtree: true });
}, 1500);