let hasColored = false;

// Put this near the top if you want an easy toggle & custom text
const ADD_COPYRIGHT = true;
const COPYRIGHT_TEXT = "© Creative Cubs  |  Personal Use Only";

// ===== CONFIG: your pages =====
const FALLBACK_PAGES = {
    "Jungle Safari": [
        { id: "js-1", src: "assets/pages/a.png", label: "Cute Cow in Meadow" },
        { id: "js-2", src: "assets/pages/b.png", label: "Animal Friends" }
    ],
    "Ocean & Sea Life": [
        { id: "os-1", src: "assets/pages/c.png", label: "Happy Turtle" },
        { id: "os-2", src: "assets/pages/d.png", label: "Dolphin Splash" }
    ],
    "Mega Vehicles": [
        { id: "mv-1", src: "assets/pages/e.png", label: "Big Truck" }
    ]
};

const canvasInner = document.getElementById("canvasInner");
const zoomRange = document.getElementById("zoomRange");

let COLORING_PAGES = FALLBACK_PAGES; // will be replaced by manifest if fetch succeeds

let hasInited = false;

async function boot() {
    const m = await fetchManifestWithCache();
    if (m) COLORING_PAGES = mapManifestToPages(m);
    if (!hasInited) { hasInited = true; init(); }
}

document.addEventListener("DOMContentLoaded", boot);


// Professional Color Palette
const PALETTE_COLORS = [
    "#000000", "#9ca3af",
    "#f59e0b", "#10b981", /* Reds, Yellow, Green */
    "#0ea5e9", "#3b82f6", "#6366f1", /* Blues & Purple */
    "#ec4899", "#78350f",   /* Pink, Brown, Slate */
];

// ===== DOM =====
const categoryList = document.getElementById("categoryList");
const thumbsContainer = document.getElementById("thumbsContainer");
const paletteContainer = document.getElementById("palette");
const brushSizeInput = document.getElementById("brushSize");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const downloadBtn = document.getElementById("downloadBtn");

const modeBrushBtn = document.getElementById("modeBrush");
const modeFillBtn = document.getElementById("modeFill");
const modeEyedropperBtn = document.getElementById("modeEyedropper");

const customColorInput = document.getElementById("customColor");
const customColorDisplay = document.getElementById("customColorDisplay");

const lineCanvas = document.getElementById("lineCanvas");
const drawCanvas = document.getElementById("drawCanvas");
const lineCtx = lineCanvas.getContext("2d", { willReadFrequently: true });
const drawCtx = drawCanvas.getContext("2d", { willReadFrequently: true });
const appRoot = document.body;            // for toggling focus-mode class
const toolbarEl = document.querySelector(".toolbar");
const canvasWrapper = document.querySelector(".canvas-wrapper");
const toggleToolsBtn = document.getElementById("toggleToolsBtn");
const focusBtn = document.getElementById("focusBtn");
const fsBtn = document.getElementById("fsBtn");
let currentLineImage = null;  // cache the Image used for the current page

// ===== STATE =====
let currentCategory = Object.keys(COLORING_PAGES)[0];
let currentPage = null;
let currentColor = PALETTE_COLORS[5]; // Default to a nice green
let currentMode = "brush";
let isDrawing = false;
let lastX = 0, lastY = 0;
let undoStack = [];
const MAX_UNDO = 25;

const thumbsEl = document.getElementById("thumbsContainer");
const mqlMobile = window.matchMedia("(max-width: 900px)");

const MANIFEST_URL = "/coloring/manifests/v1.json";   // absolute or full URL
const MANIFEST_MAX_AGE_MS = 60 * 60 * 1000;           // 1 hour cache


let toolsCollapsed = false;
let focusMode = false;

let canvasCssW = 0, canvasCssH = 0, canvasDpr = 1;

/* ---------- SESSION AD STATE ---------- */
const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

// Count how many *distinct* page loads the user triggers
let pageChangeCount = 0;
let lastPageId = null;

// Interstitial policy
const INTERSTITIAL_EVERY_N = 4;   // after every 4th page change
const INTERSTITIAL_MAX_PER_SESSION = 1;
let interstitialShown = 0;

// DOM refs
const adModal = document.getElementById("adModal");
const adCloseBtn = document.getElementById("adCloseBtn");
const adSticky = document.getElementById("adSticky");

// --- Blend controls
const blendTypeSel = document.getElementById("blendType");
const blendColorAInput = document.getElementById("blendColorA");
const blendColorBInput = document.getElementById("blendColorB");
const blendColorASwatch = document.getElementById("blendColorASwatch");
const blendColorBSwatch = document.getElementById("blendColorBSwatch");

let blendType = "solid";
let blendColorA = blendColorAInput ? blendColorAInput.value : "#10b981";
let blendColorB = blendColorBInput ? blendColorBInput.value : "#0ea5e9";

function setupBlendUI(){
  if (!blendTypeSel) return;
  blendTypeSel.addEventListener("change", e => { blendType = e.target.value; });

  const syncA = v => { blendColorA = v; if (blendColorASwatch) blendColorASwatch.style.background = v; };
  const syncB = v => { blendColorB = v; if (blendColorBSwatch) blendColorBSwatch.style.background = v; };

  ["input","change"].forEach(ev=>{
    if (blendColorAInput) blendColorAInput.addEventListener(ev, e=>syncA(e.target.value));
    if (blendColorBInput) blendColorBInput.addEventListener(ev, e=>syncB(e.target.value));
  });

  syncA(blendColorA);
  syncB(blendColorB);
}

// Show sticky only on mobile, but hide in focus mode (CSS handles most)
function updateStickyVisibility() {
    adSticky.style.display = isMobile() ? "flex" : "none";
}
updateStickyVisibility();
window.addEventListener("resize", updateStickyVisibility);


function showInterstitial() {
    interstitialShown++;
    adModal.style.display = "flex";
    adModal.setAttribute("aria-hidden", "false");

    // 3-second countdown before close is enabled (soft gate)
    let remaining = 3;
    adCloseBtn.disabled = true;
    adCloseBtn.textContent = `Close (${remaining})`;
    const t = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(t);
            adCloseBtn.disabled = false;
            adCloseBtn.textContent = "Close";
        } else {
            adCloseBtn.textContent = `Close (${remaining})`;
        }
    }, 1000);
}
adCloseBtn.addEventListener("click", () => {
    adModal.style.display = "none";
    adModal.setAttribute("aria-hidden", "true");
});

async function fetchManifestWithCache() {
    // Try cache
    try {
        const cached = localStorage.getItem("cc_manifest");
        if (cached) {
            const { savedAt, data } = JSON.parse(cached);
            if (Date.now() - savedAt < MANIFEST_MAX_AGE_MS) {
                console.log("[CC] Using cached manifest");
                return data;
            }
        }
    } catch { }

    // Fetch fresh
    try {
        const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();

        // Save cache
        try {
            localStorage.setItem("cc_manifest", JSON.stringify({ savedAt: Date.now(), data }));
        } catch { }

        return data;
    } catch (err) {
        console.warn("[CC] Manifest fetch failed, using fallback:", err);
        return null; // caller will use hardcoded fallback
    }
}

function setupZoom() {
    if (!canvasInner || !zoomRange) return;

    const applyZoom = () => {
        const scale = parseInt(zoomRange.value, 10) / 100;
        canvasInner.style.transform = `scale(${scale})`;
    };

    zoomRange.addEventListener("input", applyZoom);
    applyZoom(); // initial zoom (100%)
}

function mapManifestToPages(manifest) {
    // Return the SAME shape as FALLBACK_PAGES:
    // { "Jungle Safari": [ {id, label, src, thumb?, w?, h?}, ... ], ... }
    const mapped = {};
    for (const cat of (manifest.categories || [])) {
        const key = (cat.title && cat.title.trim()) || (cat.id || "").replace(/-/g, " ").trim() || "Untitled";
        mapped[key] = (cat.items || []).map(it => ({
            id: it.id,
            label: it.label || it.id,
            src: it.src,
            thumb: it.thumb || it.src,
            w: it.w || 1600,
            h: it.h || 1200
        }));
    }
    return mapped;
}


// ===== INIT =====
function init() {
    //console.log("[CC] init()");
    buildCategories();
    buildPalette();
    selectCategory(currentCategory);
    setupCanvasEvents();
    setupZoom();
    setupBlendUI();

    // Set initial custom color
    //   currentColor = customColorInput.value;
    //   customColorDisplay.style.backgroundColor = currentColor;
    //   updateActiveColorSwatch(null);

    window.addEventListener("resize", () => {
        // if (currentPage) loadPage(currentPage.src, false);
        if (currentPage) relayoutKeepingProgress();
    });

    setupToolModeEvents();
    setupCustomColorEvents();
    toggleToolsBtn.addEventListener("click", () => setToolsCollapsed(!toolsCollapsed));
    focusBtn.addEventListener("click", () => setFocusMode(!focusMode));
    fsBtn.addEventListener("click", toggleFullscreen);

    applyResponsiveLayout();
    mqlMobile.addEventListener("change", applyResponsiveLayout);

}

function applyResponsiveLayout() {
    // Horizontal page strip on mobile; grid on desktop
    thumbsEl.classList.toggle("horizontal", mqlMobile.matches);

    // Refit current page to new space
    // if (currentPage) loadPage(currentPage.src, false);
    if (currentPage) relayoutKeepingProgress();
}



function setToolsCollapsed(collapsed) {
    toolsCollapsed = collapsed;
    toolbarEl.classList.toggle("collapsed", collapsed);
    // Icon + label update
    const icon = toggleToolsBtn.querySelector("i");
    if (collapsed) {
        toggleToolsBtn.title = "Show Tools";
        toggleToolsBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Show Tools';
    } else {
        toggleToolsBtn.title = "Hide Tools";
        toggleToolsBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Tools';
    }
    // Refit canvas to new available space
    // if (currentPage) loadPage(currentPage.src, false);
    if (currentPage) relayoutKeepingProgress();
}

function setFocusMode(on) {
    focusMode = on;
    appRoot.classList.toggle("focus-mode", on);
    const icon = focusBtn.querySelector("i");
    if (on) {
        focusBtn.title = "Exit Focus";
        focusBtn.innerHTML = '<i class="fas fa-minimize"></i> Exit Focus';
    } else {
        focusBtn.title = "Focus Mode (hide sidebar)";
        focusBtn.innerHTML = '<i class="fas fa-maximize"></i> Focus';
    }
    // if (currentPage) loadPage(currentPage.src, false);
    if (currentPage) relayoutKeepingProgress();
}

async function toggleFullscreen() {
    const el = document.documentElement; // or canvasWrapper
    try {
        if (!document.fullscreenElement) {
            await (canvasWrapper.requestFullscreen?.() || el.requestFullscreen?.());
            fsBtn.innerHTML = '<i class="fas fa-compress"></i> Exit Fullscreen';
            fsBtn.title = "Exit Fullscreen";
        } else {
            await document.exitFullscreen();
            fsBtn.innerHTML = '<i class="fas fa-expand"></i> Fullscreen';
            fsBtn.title = "Fullscreen Canvas";
        }
    } catch (e) {
        console.warn("Fullscreen not available:", e);
    }
}

function setupToolModeEvents() {
    [modeBrushBtn, modeFillBtn, modeEyedropperBtn].forEach(btn => {
        btn.addEventListener("click", () => {
            setMode(btn.dataset.mode);
        });
    });
}

function setMode(mode) {
    currentMode = mode;
    //console.log("[CC] setMode:", mode);
    [modeBrushBtn, modeFillBtn, modeEyedropperBtn].forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });
}

function setupCustomColorEvents() {
    if (!customColorInput || !customColorDisplay) return;

    const applyCustomColor = (newColor) => {
        if (!newColor) return;
        // Just update current color & UI – do NOT change brush/fill mode
        currentColor = newColor;
        customColorDisplay.style.backgroundColor = newColor;
        updateActiveColorSwatch(null); // mark custom color as active
    };

    // Mobile browsers sometimes only fire "change", sometimes "input" – handle both
    ["input", "change"].forEach((ev) => {
        customColorInput.addEventListener(ev, (e) => {
            applyCustomColor(e.target.value);
        });
    });

    // Clicking the visible swatch opens the hidden <input type="color">
    customColorDisplay.addEventListener("click", () => {
        customColorInput.click();
    });

    // Initialize from current value
    applyCustomColor(customColorInput.value || currentColor);
}


function buildCategories() {
    // NEW: clear first
    categoryList.innerHTML = "";
    Object.keys(COLORING_PAGES).forEach((cat, index) => {
        const btn = document.createElement("button");
        btn.className = "category-btn" + (index === 0 ? " active" : "");
        btn.textContent = cat;
        btn.addEventListener("click", () => selectCategory(cat));
        categoryList.appendChild(btn);
    });
}

function selectCategory(cat) {
    currentCategory = cat;

    [...categoryList.children].forEach(b =>
        b.classList.toggle("active", b.textContent === cat)
    );

    thumbsContainer.innerHTML = "";
    const pages = COLORING_PAGES[cat] || [];

    pages.forEach((page, idx) => {
        const div = document.createElement("div");
        div.className = "thumb" + (idx === 0 ? " active" : "");
        div.dataset.id = page.id;

        const img = document.createElement("img");
        // If you have thumbs, prefer them here:
        img.src = page.thumb || page.src;
        img.alt = page.label;
        img.loading = "lazy";
        div.appendChild(img);

        div.addEventListener("click", () => {
            [...thumbsContainer.children].forEach(t =>
                t.classList.toggle("active", t === div)
            );
            currentPage = page;
            // ⬇️ pass the page object so the wrapper can count distinct changes
            loadPage(page.src, true, page);
        });

        thumbsContainer.appendChild(div);

        if (idx === 0) {
            currentPage = page;
        }
    });

    if (pages[0]) {
        // ⬇️ initial load should NOT count as a change; the wrapper handles that
        loadPage(pages[0].src, true, pages[0]);
    }
}

function buildPalette() {
    PALETTE_COLORS.forEach((color) => {
        const sw = document.createElement("div");
        sw.className = "color-swatch";
        sw.style.backgroundColor = color;
        sw.addEventListener("click", () => {
            currentColor = color;
            //setMode("brush"); // Revert to brush mode after color selection for good UX
            updateActiveColorSwatch(sw);
        });
        paletteContainer.appendChild(sw);
    });

    // Manually set initial active state for the default color
    const defaultSwatch = paletteContainer.children[PALETTE_COLORS.indexOf(currentColor)];
    if (defaultSwatch) updateActiveColorSwatch(defaultSwatch);
}

function updateActiveColorSwatch(activeSwatch) {
    [...paletteContainer.children].forEach(c => c.classList.remove("active"));
    if (activeSwatch) {
        activeSwatch.classList.add("active");
        customColorDisplay.classList.remove("active");
    } else {
        customColorDisplay.classList.add("active");
    }
}

// ===== CANVAS SIZE & IMAGE =====
function resizeCanvasToImage(img) {
    // Prefer the inner container (which we zoom), fall back to outer wrapper
    const wrapper = canvasInner || document.querySelector(".canvas-wrapper");
    if (!wrapper) {
        lineCanvas.width = drawCanvas.width = 800;
        lineCanvas.height = drawCanvas.height = 600;
        return;
    }

    // Find max box the canvas may occupy inside wrapper
    const maxW = Math.max(260, wrapper.clientWidth - 36);
    const maxH = Math.max(260, wrapper.clientHeight - 36);

    const ratio = Math.min(maxW / img.width, maxH / img.height);
    const cssW = Math.floor(img.width * ratio);
    const cssH = Math.floor(img.height * ratio);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    lineCanvas.width = Math.floor(cssW * dpr);
    lineCanvas.height = Math.floor(cssH * dpr);
    drawCanvas.width = Math.floor(cssW * dpr);
    drawCanvas.height = Math.floor(cssH * dpr);

    lineCanvas.style.width = cssW + "px";
    lineCanvas.style.height = cssH + "px";
    drawCanvas.style.width = cssW + "px";
    drawCanvas.style.height = cssH + "px";

    lineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvasCssW = cssW;
    canvasCssH = cssH;
    canvasDpr = dpr;
}



function loadPage(src, resetUndo) {
    //console.log("[CC] loadPage:", src, "resetUndo:", resetUndo);
    const img = new Image();
    // Enable CORS for potential external images (optional but good practice)
    img.crossOrigin = "Anonymous";

    img.onload = () => {
        currentLineImage = img;
        resizeCanvasToImage(img);

        // lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
        // lineCtx.drawImage(img, 0, 0, lineCanvas.width, lineCanvas.height);

        // drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        lineCtx.clearRect(0, 0, canvasCssW, canvasCssH);
        lineCtx.drawImage(img, 0, 0, canvasCssW, canvasCssH);

        drawCtx.clearRect(0, 0, canvasCssW, canvasCssH);

        undoStack = [];
        if (resetUndo) saveState();
        if (checkIfCanvasEmpty()) {
            downloadBtn.classList.remove("active");
            hasColored = false;
        } else {
            downloadBtn.classList.add("active");
            hasColored = true;
        }
    };

    img.onerror = () => {
        console.error("[CC] ERROR loading image:", src);
        lineCanvas.width = 480;
        lineCanvas.height = 320;
        drawCanvas.width = 480;
        drawCanvas.height = 320;
        lineCtx.clearRect(0, 0, 480, 320);
        lineCtx.fillStyle = "#fee2e2";
        lineCtx.fillRect(0, 0, 480, 320);
        lineCtx.fillStyle = "#b91c1c";
        lineCtx.font = "14px system-ui";
        lineCtx.fillText("Image not found:", 16, 40);
        lineCtx.fillText(src, 16, 64);
    };

    img.src = src;


}

// ---- Interstitial counters/state ----

// Provide showInterstitial() from your ad code (or use a no-op fallback)
function maybeShowInterstitial() {
    if (interstitialShown >= INTERSTITIAL_MAX_PER_SESSION) return;
    if (pageChangeCount > 0 && pageChangeCount % INTERSTITIAL_EVERY_N === 0) {
        interstitialShown++;
        showInterstitial();
    }
}

// ---- Wrap the real loadPage ----
if (typeof loadPage === "function") {
    const __origLoadPage = loadPage;

    window.loadPage = function (src, resetUndo, pageObj) {
        try {
            const nextId = (pageObj && pageObj.id) || src;

            if (lastPageId === null) {
                // First ever load in this session → set baseline, do NOT count
                lastPageId = nextId;
            } else if (nextId && nextId !== lastPageId) {
                // Real user-initiated change
                lastPageId = nextId;
                pageChangeCount++;
                maybeShowInterstitial();
            }
        } catch (e) { /* non-fatal */ }

        return __origLoadPage(src, resetUndo);
    };
}


// ===== STATE SAVE / RESTORE =====
function saveState() {
    if (!drawCanvas.width || !drawCanvas.height) return;
    if (undoStack.length >= MAX_UNDO) undoStack.shift();
    undoStack.push(drawCanvas.toDataURL("image/png"));
}

function restoreState() {
    //console.log("undoStack.length = " + undoStack.length);
    if (undoStack.length <= 2) {
        downloadBtn.classList.remove("active");
        hasColored = false;
    }
    if (undoStack.length <= 1) {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        undoStack = ["transparent"]; // Reset stack but keep a baseline state

        return;
    }
    undoStack.pop();
    const url = undoStack[undoStack.length - 1];
    const img = new Image();
    img.onload = () => {
        // drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        // drawCtx.drawImage(img, 0, 0);
        drawCtx.clearRect(0, 0, canvasCssW, canvasCssH);
        drawCtx.drawImage(img, 0, 0, canvasCssW, canvasCssH);
    };
    img.src = url;

    // if (checkIfCanvasEmpty()) {
    //   downloadBtn.classList.remove("active");
    // } else {
    //   downloadBtn.classList.add("active");
    // }

}

// ===== DRAWING / FILL / EYEDROPPER =====
function setupCanvasEvents() {
    const getPos = (e) => {
        const rect = drawCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        // Map to CSS pixels (NOT device pixels)
        return {
            x: ((clientX - rect.left) / rect.width) * canvasCssW,
            y: ((clientY - rect.top) / rect.height) * canvasCssH
        };
    };


    const start = (e) => {
        e.preventDefault();
        if (!drawCanvas.width) {
            console.warn("[CC] drawCanvas has zero size, ignoring action");
            return;
        }
        const { x, y } = getPos(e);
        const mode = currentMode;

        if (mode === "brush") {
            isDrawing = true;
            lastX = x;
            lastY = y;
            drawCtx.lineCap = "round";
            drawCtx.lineJoin = "round";
            drawCtx.strokeStyle = currentColor;
            drawCtx.lineWidth = parseInt(brushSizeInput.value, 10);
        } else if (mode === "fill") {
        const style = (blendType === "solid")
            ? { type: "solid", solidColor: currentColor }          // keep existing single-color fill
            : { type: blendType, colorA: blendColorA, colorB: blendColorB };
        floodFillStyled(x, y, style);
        saveState();
        } else if (mode === "eyedropper") {
            eyedropper(x, y);
        }
    };

    const move = (e) => {
        if (!isDrawing || currentMode !== "brush") return;
        e.preventDefault();
        const { x, y } = getPos(e);
        drawCtx.beginPath();
        drawCtx.moveTo(lastX, lastY);
        drawCtx.lineTo(x, y);
        drawCtx.stroke();
        lastX = x;
        lastY = y;
        downloadBtn.classList.add("active");
        hasColored = true;
    };

    const end = () => {
        if (isDrawing && currentMode === "brush") {
            isDrawing = false;
            saveState();
        }
    };

    ["mousedown", "touchstart"].forEach(ev =>
        drawCanvas.addEventListener(ev, start, { passive: false })
    );
    ["mousemove", "touchmove"].forEach(ev =>
        drawCanvas.addEventListener(ev, move, { passive: false })
    );
    ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(ev =>
        drawCanvas.addEventListener(ev, end)
    );

    undoBtn.addEventListener("click", restoreState);
    clearBtn.addEventListener("click", () => {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        undoStack = [];
        saveState();

        downloadBtn.classList.remove("active");
    });
    downloadBtn.addEventListener("click", downloadArtwork);
}

// Helper: RGB to Hex
function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

function relayoutKeepingProgress() {
    if (!currentLineImage) return;  // nothing loaded yet

    // 1) Snapshot the current colored layer (device-pixel size)
    let snapshot = null;
    if (drawCanvas.width && drawCanvas.height) {
        snapshot = document.createElement("canvas");
        snapshot.width = drawCanvas.width;
        snapshot.height = drawCanvas.height;
        snapshot.getContext("2d").drawImage(drawCanvas, 0, 0);
    }

    // 2) Resize canvases to new wrapper size based on the same line image
    resizeCanvasToImage(currentLineImage);

    // 3) Redraw line art at CSS size
    lineCtx.clearRect(0, 0, canvasCssW, canvasCssH);
    lineCtx.drawImage(currentLineImage, 0, 0, canvasCssW, canvasCssH);

    // 4) Restore the colored layer, scaled to the new CSS size
    drawCtx.clearRect(0, 0, canvasCssW, canvasCssH);
    if (snapshot) {
        drawCtx.drawImage(snapshot, 0, 0, canvasCssW, canvasCssH);
    }

    // 5) Don’t touch undoStack — user progress remains.
    //    Refresh download button state
    if (checkIfCanvasEmpty()) {
        downloadBtn.classList.remove("active");
        hasColored = false;
    } else {
        downloadBtn.classList.add("active");
        hasColored = true;
    }
}

// Helper: Hex to RGB
function hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// New Feature: Eyedropper
function eyedropper(x, y) {

    const sx = Math.floor(x * canvasDpr);
    const sy = Math.floor(y * canvasDpr);


    const w = drawCanvas.width;
    const h = drawCanvas.height;
    if (!w || !h) return;

    // Create temporary composite canvas to read pixel from
    const temp = document.createElement("canvas");
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext("2d");

    // Draw both layers (line art and colored art)
    tctx.drawImage(lineCanvas, 0, 0);
    tctx.drawImage(drawCanvas, 0, 0);

    const imgData = tctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // const sx = Math.floor(x);
    // const sy = Math.floor(y);
    const startIdx = (sy * w + sx) * 4;

    const r = data[startIdx];
    const g = data[startIdx + 1];
    const b = data[startIdx + 2];
    const a = data[startIdx + 3];

    // Convert sampled color to Hex
    const sampledColor = rgbToHex(r, g, b);

    // If the sampled color is mostly transparent (background), ignore
    if (a < 50) return;

    // Set the new current color
    currentColor = sampledColor;
    //console.log("[CC] Eyedropper sampled color:", sampledColor);

    // Update UI
    // 1. Check if color exists in palette
    // 1. Check if color exists in palette
    const sampledRGB = toRgbString(sampledColor); // sampledColor is #hex from rgbToHex(..)
    let matchedSwatch = [...paletteContainer.children].find(sw => {
        return toRgbString(sw.style.backgroundColor) === sampledRGB;
    });

    if (matchedSwatch) {
        currentColor = sampledColor; // keep hex as working color
        updateActiveColorSwatch(matchedSwatch);
    } else {
        customColorInput.value = sampledColor;               // sync picker
        customColorDisplay.style.backgroundColor = sampledColor;
        currentColor = sampledColor;
        updateActiveColorSwatch(null);
    }
    //   setMode("brush");
}


function floodFill(startX, startY, fillColor) {

    // Convert CSS-pixel input to device-pixel indices
    const sx = Math.floor(startX * canvasDpr);
    const sy = Math.floor(startY * canvasDpr);

    const w = drawCanvas.width;
    const h = drawCanvas.height;
    if (!w || !h) return;

    const temp = document.createElement("canvas");
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext("2d");

    // Composite (used only for region detection)
    // Draw line art first, then colored art to get the total canvas state
    tctx.drawImage(lineCanvas, 0, 0);
    tctx.drawImage(drawCanvas, 0, 0);

    const imgData = tctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // const sx = Math.floor(startX);
    // const sy = Math.floor(startY);
    const startIdx = (sy * w + sx) * 4;

    const target = {
        r: data[startIdx],
        g: data[startIdx + 1],
        b: data[startIdx + 2],
        a: data[startIdx + 3]
    };

    const isLinePixel = (idx) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        // treat dark, opaque pixels as line art (walls)
        return a > 200 && r < 40 && g < 40 && b < 40; // Reduced tolerance for lines
    };

    // If clicked directly on a line, ignore
    if (isLinePixel(startIdx)) return;

    // const [fr, fg, fb] = hexToRgb(fillColor);
    const [fr, fg, fb] = parseColorToRGB(fillColor);


    // Small tolerance so anti-aliased edges fill nicely
    const TOL = 24; // Increased tolerance for smoother filling
    const match = (idx) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        // Also check that we are not trying to fill a region that is already the fill color
        const isTargetFill = (
            Math.abs(r - fr) <= TOL &&
            Math.abs(g - fg) <= TOL &&
            Math.abs(b - fb) <= TOL
        );

        return (
            !isTargetFill && // Don't re-fill
            Math.abs(r - target.r) <= TOL &&
            Math.abs(g - target.g) <= TOL &&
            Math.abs(b - target.b) <= TOL &&
            Math.abs(a - target.a) <= TOL
        );
    };

    if (!match(startIdx)) return;

    const stack = [[sx, sy]];

    while (stack.length) {
        const [x, y] = stack.pop();
        if (x < 0 || x >= w || y < 0 || y >= h) continue;

        const idx = (y * w + x) * 4;
        if (!match(idx) || isLinePixel(idx)) continue;

        // Set fill color on temporary data
        data[idx] = fr;
        data[idx + 1] = fg;
        data[idx + 2] = fb;
        data[idx + 3] = 255;

        // Check neighbors
        stack.push([x + 1, y]);
        stack.push([x - 1, y]);
        stack.push([x, y + 1]);
        stack.push([x, y - 1]);
    }

    // Re-read existing drawn pixels from drawCanvas
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.putImageData(imgData, 0, 0);

    // Restore original image data from drawCanvas for the putImageData call 
    // to only contain the filled region (and existing draw content)
    const finalImgData = drawCtx.getImageData(0, 0, w, h);
    const finalData = finalImgData.data;

    // Final cleanup: set line pixels to transparent on the draw layer
    // This is a complex logic step, for simplification, we just ensure 
    // line art remains visible by having drawCtx be transparent where lines are.
    // The line layer (lineCanvas) handles the actual lines.

    // Paint the result onto drawCanvas
    drawCtx.clearRect(0, 0, w, h);
    drawCtx.putImageData(finalImgData, 0, 0);
    downloadBtn.classList.add("active");
    hasColored = true;
}

function floodFillStyled(startX, startY, style) {
  // 1) Build mask for the clicked region (similar to floodFill, but writes alpha only)
  const sx = Math.floor(startX * canvasDpr);
  const sy = Math.floor(startY * canvasDpr);

  const w = drawCanvas.width, h = drawCanvas.height;
  if (!w || !h) return;

  const comp = document.createElement("canvas");
  comp.width = w; comp.height = h;
  const cctx = comp.getContext("2d");
  cctx.drawImage(lineCanvas, 0, 0);
  cctx.drawImage(drawCanvas, 0, 0);

  const imgData = cctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const startIdx = (sy * w + sx) * 4;

  const isLinePixel = (idx) => {
    const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
    return a > 200 && r < 40 && g < 40 && b < 40;
  };
  if (isLinePixel(startIdx)) return;

  const target = {
    r: data[startIdx], g: data[startIdx+1], b: data[startIdx+2], a: data[startIdx+3]
  };

  const TOL = 24;
  const match = (idx) => {
    const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
    return Math.abs(r-target.r)<=TOL && Math.abs(g-target.g)<=TOL &&
           Math.abs(b-target.b)<=TOL && Math.abs(a-target.a)<=TOL;
  };
  if (!match(startIdx)) return;

  // Mask canvas (alpha=255 inside region)
  const mask = document.createElement("canvas");
  mask.width = w; mask.height = h;
  const mctx = mask.getContext("2d");
  const mdata = mctx.createImageData(w, h);
  const md = mdata.data;

  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x<0 || x>=w || y<0 || y>=h) continue;
    const idx = (y*w + x) * 4;
    if (!match(idx) || isLinePixel(idx)) continue;

    // Mark pixel in mask (opaque white)
    md[idx]   = 255; md[idx+1] = 255; md[idx+2] = 255; md[idx+3] = 255;

    // "consume" so we don't visit again
    data[idx] = 255; data[idx+1] = 0; data[idx+2] = 255; data[idx+3] = 255;

    stack.push([x+1,y]); stack.push([x-1,y]); stack.push([x,y+1]); stack.push([x,y-1]);
  }
  mctx.putImageData(mdata, 0, 0);

  // 2) Create a texture layer (solid/gradient/pattern) covering the full canvas
  const tex = document.createElement("canvas");
  tex.width = w; tex.height = h;
  const tctx = tex.getContext("2d");
  applyStyleFill(tctx, style, w, h);

  // 3) Clip the texture to the region via the mask: texture DESTINATION-IN mask
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(mask, 0, 0);

  // 4) Paint clipped texture onto the user color layer
  drawCtx.globalCompositeOperation = "source-over";
//   drawCtx.drawImage(tex, 0, 0);
  drawCtx.drawImage(tex, 0, 0, canvasCssW, canvasCssH);

  downloadBtn.classList.add("active");
  hasColored = true;
}

function applyStyleFill(ctx, style, w, h){
  const A = style.colorA || "#10b981";
  const B = style.colorB || "#0ea5e9";
  const type = style.type || "solid";

  if (type === "solid") {
    ctx.fillStyle = style.solidColor || currentColor;
    ctx.fillRect(0,0,w,h);
    return;
  }

  if (type === "linear-lr" || type === "linear-tb" || type === "radial") {
    let grad;
    if (type === "linear-lr") grad = ctx.createLinearGradient(0, 0, w, 0);
    if (type === "linear-tb") grad = ctx.createLinearGradient(0, 0, 0, h);
    if (type === "radial") {
      const r = Math.sqrt(w*w + h*h)/2;
      grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, r);
    }
    grad.addColorStop(0, A);
    grad.addColorStop(1, B);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,w,h);
    return;
  }

  if (type === "stripe" || type === "dots") {
    // small pattern tile
    const tile = document.createElement("canvas");
    const s = (type === "stripe") ? 16 : 12;
    tile.width = s; tile.height = s;
    const p = tile.getContext("2d");

    if (type === "stripe") {
      // background B
      p.fillStyle = B; p.fillRect(0,0,s,s);
      // diagonal A
      p.strokeStyle = A; p.lineWidth = 6;
      p.beginPath(); p.moveTo(-4, s-4); p.lineTo(s+4, -4); p.stroke();
    } else {
      // dots: B background with A circles
      p.fillStyle = B; p.fillRect(0,0,s,s);
      p.fillStyle = A;
      p.beginPath(); p.arc(s/2, s/2, s*0.25, 0, Math.PI*2); p.fill();
    }
    const pat = ctx.createPattern(tile, "repeat");
    ctx.fillStyle = pat;
    ctx.fillRect(0,0,w,h);
    return;
  }
}

// Normalize any CSS color (#hex or rgb/rgba) to [r,g,b]
function parseColorToRGB(color) {
    if (!color) return [0, 0, 0];
    color = String(color).trim();

    if (color.startsWith('#')) {
        return hexToRgb(color);
    }
    // rgb/rgba(...)
    const m = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    // Fallback via canvas if needed
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    try { ctx.fillStyle = color; } catch { return [0, 0, 0]; }
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
}

function toRgbString(color) {
    const [r, g, b] = parseColorToRGB(color);
    return `rgb(${r}, ${g}, ${b})`;
}

function checkIfCanvasEmpty() {
    const pixels = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height).data;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) return false; // found a non-transparent pixel
    }
    return true;
}


// ===== DOWNLOAD =====
function downloadArtwork() {
    if (!lineCanvas.width) return;
    const w = lineCanvas.width;
    const h = lineCanvas.height;

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");

    // 1) White background
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);

    // 2) User coloring
    octx.drawImage(drawCanvas, 0, 0);

    // 3) Line art on top
    octx.drawImage(lineCanvas, 0, 0);

    // 4) Copyright footer (clean, subtle, auto-scales)
    if (ADD_COPYRIGHT) {
        const padY = Math.round(h * 0.028);              // bottom padding
        const fontSize = Math.max(12, Math.round(w * 0.024));
        octx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Inter, sans-serif`;
        octx.textAlign = "center";
        octx.textBaseline = "alphabetic";

        // soft background strip for readability (optional but nice)
        const metrics = octx.measureText(COPYRIGHT_TEXT);
        const textW = metrics.width;
        const stripPadX = Math.round(fontSize * 0.6);
        const stripPadY = Math.round(fontSize * 0.5);
        const cx = w / 2;
        const cy = h - padY;

        octx.fillStyle = "rgba(255,255,255,0.75)";
        octx.fillRect(cx - textW / 2 - stripPadX, cy - fontSize - stripPadY + 4,
            textW + stripPadX * 2, fontSize + stripPadY * 2);

        // text with slight shadow
        octx.shadowColor = "rgba(0,0,0,0.25)";
        octx.shadowBlur = 2;
        octx.fillStyle = "rgba(0,0,0,0.65)";
        octx.fillText(COPYRIGHT_TEXT, cx, cy);
        octx.shadowBlur = 0;
    }

    const filename = (currentPage ? currentPage.label.replace(/\s/g, '-') : "artwork") + ".png";
    const link = document.createElement("a");
    link.download = filename;
    link.href = out.toDataURL("image/png");
    link.click();
}


[lineCanvas, drawCanvas].forEach(c => {
    c.addEventListener("contextmenu", e => e.preventDefault());
});

