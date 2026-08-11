import { saveSettingsToStorage, loadSettingsFromStorage, DEFAULT_SETTINGS } from './storage.js';
import { convertArknToDraw, detectAndParseJson } from './converter.js';
import { sampleCellColor } from './sampler.js';
import { validateOutputJson } from './validator.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

const previewContainer = document.getElementById('previewContainer');
const previewCanvas = document.getElementById('previewCanvas');
const resetPreviewBtn = document.getElementById('resetPreviewBtn');
const toggleGridBtn = document.getElementById('toggleGridBtn');
const paletteStatus = document.getElementById('paletteStatus');

let img = new Image();
// 1. 使用 DEFAULT_SETTINGS 初始化变量
let grid = { x: 50, y: 50, w: 400, h: 400, cols: DEFAULT_SETTINGS.cols, rows: DEFAULT_SETTINGS.rows };
let isDragging = false;
let dragType = null;
let dragStartX, dragStartY;
let initialGrid;

let handleRadius = DEFAULT_SETTINGS.handleSize;
let rawSampledCells = [];
let colorOverrides = {};

let previewScale = 1;
let previewPanX = 0;
let previewPanY = 0;
let isPreviewDragging = false;
let previewStartX = 0, previewStartY = 0;
let activePointers = new Map();
let initialPinchDist = 0;
let initialPinchScale = 1;
let showPreviewGrid = DEFAULT_SETTINGS.showPreviewGrid;
let currentPreviewCells = [];
let currentPreviewCols = grid.cols;
let currentPreviewRows = grid.rows;

const convertModal = document.getElementById('convertModal');
const exportModal = document.getElementById('exportModal');

function adjustExportResolution(source = 'width') {
    const cols = grid.cols || DEFAULT_SETTINGS.cols;
    const rows = grid.rows || DEFAULT_SETTINGS.rows;
    const wInput = document.getElementById('pngWidth');
    const hInput = document.getElementById('pngHeight');
    if (!wInput || !hInput) return;

    const maxK = Math.max(1, Math.floor(Math.min(4000 / cols, 4000 / rows)));
    const base = source === 'height' ? rows : cols;
    const rawVal = parseInt(source === 'height' ? hInput.value : wInput.value) || (base * 40);

    const k = Math.max(1, Math.min(Math.round(rawVal / base), maxK));

    wInput.value = k * cols;
    hInput.value = k * rows;
}

(function initTooltips() {
    const tooltip = document.getElementById('customTooltip');
    if (!tooltip) return;
    let longPressTimer = null;

    function show(btn, text) {
        if (!text) return;
        const rect = btn.getBoundingClientRect();
        tooltip.textContent = text;
        tooltip.style.left = (rect.left + rect.width / 2) + 'px';
        tooltip.style.top = (rect.bottom + 6) + 'px';
        tooltip.style.opacity = '1';
    }

    function hide() {
        tooltip.style.opacity = '0';
        clearTimeout(longPressTimer);
    }

    document.querySelectorAll('[data-tooltip]').forEach(btn => {
        const text = btn.getAttribute('data-tooltip');
        if (!text) return;
        btn.addEventListener('mouseenter', () => show(btn, text));
        btn.addEventListener('mouseleave', hide);
        btn.addEventListener('touchstart', () => { longPressTimer = setTimeout(() => show(btn, text), 600); });
        btn.addEventListener('touchend', hide);
        btn.addEventListener('touchcancel', hide);
    });
})();

function fetchOnlinePalette() {
    fetch('./色板.json?t=' + Date.now())
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            document.getElementById('paletteInput').value = JSON.stringify(data, null, 4);
            saveSettingsToStorage({ showPreviewGrid });
            paletteStatus.textContent = '✓ 当前使用在线色板';
            alert('在线色板更新完成！\n已缓存到浏览器存储！\n下次打开将切换为缓存');
        })
        .catch(() => alert('加载 ./色板.json 失败'));
}

document.getElementById('onlineUpdateBtn').addEventListener('click', fetchOnlinePalette);

window.addEventListener('DOMContentLoaded', () => {
    // 2. 统一从 loadSettingsFromStorage 读取完整设置（已包含默认回退机制）
    const s = loadSettingsFromStorage();
    
    document.getElementById('colsInput').value = s.cols;
    document.getElementById('rowsInput').value = s.rows;
    syncHandleSize(s.handleSize);
    document.getElementById('allowOutOfBounds').checked = s.allowOutOfBounds;
    document.getElementById('samplingMethod').value = s.samplingMethod;
    if (s.paletteJson) document.getElementById('paletteInput').value = s.paletteJson;
    document.getElementById('fileNameRule').value = s.fileNameRule;
    document.getElementById('pngWidth').value = s.pngWidth;
    document.getElementById('pngHeight').value = s.pngHeight;
    showPreviewGrid = s.showPreviewGrid !== undefined ? s.showPreviewGrid : DEFAULT_SETTINGS.showPreviewGrid;
const gridIcon = toggleGridBtn.querySelector('i');
if (gridIcon) {
    gridIcon.className = showPreviewGrid ? 'icon-grid-cross' : 'icon-grid';
}

    grid.cols = parseInt(s.cols) || DEFAULT_SETTINGS.cols;
    grid.rows = parseInt(s.rows) || DEFAULT_SETTINGS.rows;
    enforceSquareCells();

    const paletteInput = document.getElementById('paletteInput');
    if (!paletteInput.value.trim() || paletteInput.value === '[]') {
        fetchOnlinePalette();
    } else {
        paletteStatus.textContent = '✓ 使用缓存的色板';
    }

    ['colsInput','rowsInput','allowOutOfBounds','samplingMethod','paletteInput','fileNameRule','pngWidth','pngHeight'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => saveSettingsToStorage({ showPreviewGrid }));
    });

    document.getElementById('pngWidth').addEventListener('change', () => {
        adjustExportResolution('width');
        saveSettingsToStorage({ showPreviewGrid });
    });
    document.getElementById('pngHeight').addEventListener('change', () => {
        adjustExportResolution('height');
        saveSettingsToStorage({ showPreviewGrid });
    });

    adjustExportResolution('width');
});

toggleGridBtn.addEventListener('click', () => {
    showPreviewGrid = !showPreviewGrid;
    const gridIcon = toggleGridBtn.querySelector('i');
    if (gridIcon) {
        gridIcon.className = showPreviewGrid ? 'icon-grid-cross' : 'icon-grid';
    }
    saveSettingsToStorage({ showPreviewGrid });
    redrawPreviewFromCache();
});

const handleRange = document.getElementById('handleSizeRange');
const handleInput = document.getElementById('handleSizeInput');
function syncHandleSize(val) {
    val = Math.max(8, Math.min(40, parseInt(val) || DEFAULT_SETTINGS.handleSize));
    handleRange.value = val;
    handleInput.value = val;
    handleRadius = val;
    draw();
}
handleRange.addEventListener('input', e => { syncHandleSize(e.target.value); saveSettingsToStorage({ showPreviewGrid }); });
handleInput.addEventListener('input', e => { syncHandleSize(e.target.value); saveSettingsToStorage({ showPreviewGrid }); });

document.getElementById('paletteFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            document.getElementById('paletteInput').value = JSON.stringify(JSON.parse(ev.target.result), null, 4);
            saveSettingsToStorage({ showPreviewGrid });
            paletteStatus.textContent = '✓ 已加载文件色板';
        } catch { alert('色板 JSON 解析失败'); }
    };
    reader.readAsText(file);
});

function enforceSquareCells() {
    if (grid.cols > 0 && grid.rows > 0) grid.h = grid.w * (grid.rows / grid.cols);
}
document.getElementById('colsInput').addEventListener('change', e => {
    grid.cols = Math.max(1, parseInt(e.target.value) || 1);
    enforceSquareCells(); clampGridBounds(); draw();
    adjustExportResolution('width');
});
document.getElementById('rowsInput').addEventListener('change', e => {
    grid.rows = Math.max(1, parseInt(e.target.value) || 1);
    enforceSquareCells(); clampGridBounds(); draw();
    adjustExportResolution('height');
});
document.getElementById('allowOutOfBounds').addEventListener('change', () => { clampGridBounds(); draw(); });

function clampGridBounds() {
    if (document.getElementById('allowOutOfBounds').checked || !img.src) return;
    const ratio = grid.rows / grid.cols;
    if (grid.w > img.width) { grid.w = img.width; grid.h = grid.w * ratio; }
    if (grid.h > img.height) { grid.h = img.height; grid.w = grid.h / ratio; }
    grid.x = Math.max(0, Math.min(grid.x, img.width - grid.w));
    grid.y = Math.max(0, Math.min(grid.y, img.height - grid.h));
}

function runSamplingAndAnalysis() {
    if (!img.src) return alert('请先加载图片');
    let palette;
    try { palette = JSON.parse(document.getElementById('paletteInput').value); } catch { return alert('色板 JSON 格式错误'); }
    const method = document.getElementById('samplingMethod').value;
    const cw = grid.w / grid.cols, ch = grid.h / grid.rows;
    rawSampledCells = [];
    colorOverrides = {};
    for (let y = 0; y < grid.rows; y++) {
        for (let x = 0; x < grid.cols; x++) {
            const sx = grid.x + x * cw, sy = grid.y + y * ch;
            const match = sampleCellColor(sx, sy, cw, ch, method, palette, offscreenCanvas, offscreenCtx);
            if (match) rawSampledCells.push({ x, y, originalHex: match.hex.toUpperCase(), originalPalPos: `第${match.row}行第${match.col}列` });
        }
    }
    buildColorMappingList(palette);
    applyMappingAndRender(palette, 'arkn-24x24');
}

document.getElementById('imageInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            offscreenCanvas.width = img.width;
            offscreenCanvas.height = img.height;
            offscreenCtx.drawImage(img, 0, 0);
            const imgRatio = img.width / img.height;
            const gridRatio = grid.cols / grid.rows;
            if (Math.abs(imgRatio - gridRatio) < 0.005) {
                grid.x = 0; grid.y = 0; grid.w = img.width; grid.h = img.height;
            } else {
                const minEdge = Math.min(img.width, img.height);
                grid.w = minEdge * 0.8;
                enforceSquareCells();
                grid.x = (img.width - grid.w) / 2;
                grid.y = (img.height - grid.h) / 2;
                clampGridBounds();
            }
            draw();
            runSamplingAndAnalysis();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

function getHandles() {
    return {
        tl: { x: grid.x, y: grid.y },
        tr: { x: grid.x + grid.w, y: grid.y },
        bl: { x: grid.x, y: grid.y + grid.h },
        br: { x: grid.x + grid.w, y: grid.y + grid.h },
        t:  { x: grid.x + grid.w / 2, y: grid.y },
        b:  { x: grid.x + grid.w / 2, y: grid.y + grid.h },
        l:  { x: grid.x, y: grid.y + grid.h / 2 },
        r:  { x: grid.x + grid.w, y: grid.y + grid.h / 2 }
    };
}

function draw() {
    if (!img.src) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(79,70,229,0.12)';
    ctx.fillRect(grid.x, grid.y, grid.w, grid.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, canvas.width / 900);
    ctx.beginPath();
    const cw = grid.w / grid.cols, ch = grid.h / grid.rows;
    for (let i = 0; i <= grid.cols; i++) { ctx.moveTo(grid.x + i * cw, grid.y); ctx.lineTo(grid.x + i * cw, grid.y + grid.h); }
    for (let i = 0; i <= grid.rows; i++) { ctx.moveTo(grid.x, grid.y + i * ch); ctx.lineTo(grid.x + grid.w, grid.y + i * ch); }
    ctx.stroke();
    const handles = getHandles();
    for (let k in handles) {
        ctx.beginPath();
        ctx.arc(handles[k].x, handles[k].y, handleRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#4f46e5';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, handleRadius / 4);
        ctx.stroke();
    }
}

function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * canvas.width / rect.width,
        y: (e.clientY - rect.top) * canvas.height / rect.height
    };
}
canvas.addEventListener('pointerdown', function(e) {
    if (!img.src) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    const handles = getHandles();
    dragType = null;
    const hitThreshold = handleRadius * 1.5;
    for (let k in handles) {
        if (Math.hypot(pt.x - handles[k].x, pt.y - handles[k].y) < hitThreshold) { dragType = k; break; }
    }
    if (!dragType && pt.x > grid.x && pt.x < grid.x + grid.w && pt.y > grid.y && pt.y < grid.y + grid.h) dragType = 'all';
    if (dragType) {
        isDragging = true;
        dragStartX = pt.x; dragStartY = pt.y;
        initialGrid = { ...grid };
    }
});
canvas.addEventListener('pointermove', function(e) {
    if (!isDragging) return;
    const pt = getCanvasPoint(e);
    const dx = pt.x - dragStartX, dy = pt.y - dragStartY;
    const ratio = grid.rows / grid.cols;
    if (dragType === 'all') { grid.x = initialGrid.x + dx; grid.y = initialGrid.y + dy; }
    else if (dragType === 'br' || dragType === 'r') { grid.w = Math.max(30, initialGrid.w + dx); grid.h = grid.w * ratio; }
    else if (dragType === 'bl' || dragType === 'l') { const nw = Math.max(30, initialGrid.w - dx); grid.x = initialGrid.x + (initialGrid.w - nw); grid.w = nw; grid.h = grid.w * ratio; }
    else if (dragType === 'tr' || dragType === 't') { grid.w = Math.max(30, initialGrid.w + dx); grid.h = grid.w * ratio; grid.y = initialGrid.y + (initialGrid.h - grid.h); }
    else if (dragType === 'tl') { const nw = Math.max(30, initialGrid.w - dx); grid.x = initialGrid.x + (initialGrid.w - nw); grid.w = nw; grid.h = grid.w * ratio; grid.y = initialGrid.y + (initialGrid.h - grid.h); }
    else if (dragType === 'b') { grid.h = Math.max(30, initialGrid.h + dy); grid.w = grid.h / ratio; }
    clampGridBounds();
    draw();
});
canvas.addEventListener('pointerup', function(e) {
    if (isDragging) { canvas.releasePointerCapture(e.pointerId); isDragging = false; }
});

document.getElementById('generateBtn').addEventListener('click', runSamplingAndAnalysis);

function buildColorMappingList(palette) {
    const list = document.getElementById('colorMappingList');
    const group = document.getElementById('colorMappingGroup');
    list.innerHTML = '';
    const counts = {};
    rawSampledCells.forEach(c => counts[c.originalHex] = (counts[c.originalHex] || 0) + 1);
    const uniq = Object.keys(counts);
    if (!uniq.length) { group.style.display = 'none'; return; }
    group.style.display = 'flex';
    uniq.forEach(hex => {
        const div = document.createElement('div'); div.className = 'color-mapping-item';
        const item = palette.find(p => p.hex.toUpperCase() === hex);
        const info = document.createElement('div'); info.className = 'color-info';
        info.innerHTML = `<div class="color-badge" style="background:${hex};"></div><span>${hex} (${item ? `第${item.row}行第${item.col}列` : ''}) - <b>${counts[hex]}格</b></span>`;
        const sel = document.createElement('select');
        palette.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.hex.toUpperCase();
            opt.textContent = `${p.hex.toUpperCase()} (第${p.row}行第${p.col}列)`;
            if (p.hex.toUpperCase() === hex) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', e => { colorOverrides[hex] = e.target.value; applyMappingAndRender(palette, 'arkn-24x24'); });
        div.appendChild(info); div.appendChild(sel); list.appendChild(div);
    });
}

function applyMappingAndRender(palette, fmt = 'arkn-24x24') {
    let seq = 1;
    const cells = rawSampledCells.map(c => {
        const cur = colorOverrides[c.originalHex] || c.originalHex;
        const item = palette.find(p => p.hex.toUpperCase() === cur);
        return { x: c.x, y: c.y, seq: seq++, region: c.x < Math.floor(grid.cols / 2) ? 1 : 2, hex: cur, palPos: item ? `第${item.row}行第${item.col}列` : c.originalPalPos };
    });
    const data = { size: grid.cols, cells };
    const paletteVal = document.getElementById('paletteInput').value;
    const result = fmt === 'arknights_draw' ? convertArknToDraw(data, paletteVal, grid.cols) : data;
    document.getElementById('outputJson').value = JSON.stringify(result, null, fmt === 'arknights_draw' ? 2 : 0);
    renderPreviewCanvas(grid.cols, grid.rows, cells);
}

function handleExport(fmt) {
    const validated = validateOutputJson();
    if (!validated) return;

    let p = [];
    try { p = JSON.parse(document.getElementById('paletteInput').value); } catch {}

    if (rawSampledCells.length > 0) {
        applyMappingAndRender(p, fmt);
    } else {
        const cells = validated.cells;
        rawSampledCells = cells.map(c => ({ x: c.x, y: c.y, originalHex: c.hex, originalPalPos: c.palPos || '' }));
        applyMappingAndRender(p, fmt);
    }
}

document.getElementById('convertJsonBtn').addEventListener('click', () => { convertModal.style.display = 'flex'; });
document.getElementById('exportArknBtn').addEventListener('click', () => { handleExport('arkn-24x24'); convertModal.style.display = 'none'; });
document.getElementById('exportDrawBtn').addEventListener('click', () => { handleExport('arknights_draw'); convertModal.style.display = 'none'; });

function getDynamicFileName(ext) {
    let rule = document.getElementById('fileNameRule').value.trim() || DEFAULT_SETTINGS.fileNameRule;
    rule = rule.replace('{time}', Date.now());
    return `${rule}.${ext}`;
}

document.getElementById('btnCopy').addEventListener('click', () => {
    if (!validateOutputJson()) return;
    const text = document.getElementById('outputJson').value;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(showCopySuccess).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
});

document.getElementById('btnExportJson').addEventListener('click', () => {
    if (!validateOutputJson()) return;
    const text = document.getElementById('outputJson').value.trim();
    const blob = new Blob([text], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = getDynamicFileName('json');
    link.click();
});

document.getElementById('btnDownloadPng').addEventListener('click', () => {
    if (!validateOutputJson()) return;
    if (!currentPreviewCells || currentPreviewCells.length === 0) return alert('没有可导出的图纸数据！');

    adjustExportResolution('width');
    const targetW = parseInt(document.getElementById('pngWidth').value);
    const targetH = parseInt(document.getElementById('pngHeight').value);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = targetW;
    tempCanvas.height = targetH;
    const tCtx = tempCanvas.getContext('2d');

    tCtx.fillStyle = '#FFFFFF';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    const cellW = targetW / currentPreviewCols;
    const cellH = targetH / currentPreviewRows;

    currentPreviewCells.filter(c => c.x >= 0 && c.x < currentPreviewCols && c.y >= 0 && c.y < currentPreviewRows).forEach(c => {
        tCtx.fillStyle = c.hex || '#FFFFFF';
        tCtx.fillRect(c.x * cellW, c.y * cellH, cellW + 0.5, cellH + 0.5);
        if (showPreviewGrid) {
            tCtx.strokeStyle = 'rgba(0,0,0,0.15)';
            tCtx.lineWidth = Math.max(1, Math.min(targetW, targetH) / 1000);
            tCtx.strokeRect(c.x * cellW, c.y * cellH, cellW, cellH);
        }
    });

    const link = document.createElement('a');
    link.download = getDynamicFileName('png');
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
});

document.getElementById('btnExportSettings').addEventListener('click', () => exportModal.style.display = 'flex');
document.getElementById('closeConvertModalBtn').addEventListener('click', () => convertModal.style.display = 'none');
document.getElementById('closeExportModalBtn').addEventListener('click', () => exportModal.style.display = 'none');

convertModal.addEventListener('click', e => { if (e.target === convertModal) convertModal.style.display = 'none'; });
exportModal.addEventListener('click', e => { if (e.target === exportModal) exportModal.style.display = 'none'; });

function fallbackCopy(t) {
    const ta = document.getElementById('outputJson');
    ta.select();
    try { document.execCommand('copy'); showCopySuccess(); } catch { alert('复制失败'); }
}

function showCopySuccess() {
    const btn = document.getElementById('btnCopy'); const orig = btn.textContent;
    btn.textContent = '成功！'; btn.style.background = '#10b981';
    setTimeout(() => { btn.textContent = orig; btn.style.background = 'var(--primary)'; }, 1500);
}

const outputJson = document.getElementById('outputJson');
outputJson.removeAttribute('readonly');
outputJson.removeAttribute('disabled');

outputJson.addEventListener('blur', function() {
    const text = this.value.trim();
    if (!text) return;
    const parsed = detectAndParseJson(text);
    if (!parsed) {
        alert('转换失败：文本框中的内容不是合法的 JSON 或不受支持的格式！');
        return;
    }
    
    grid.cols = parsed.cols;
    grid.rows = parsed.rows;
    document.getElementById('colsInput').value = parsed.cols;
    document.getElementById('rowsInput').value = parsed.rows;

    let p = [];
    try { p = JSON.parse(document.getElementById('paletteInput').value); } catch {}

    rawSampledCells = parsed.cells.map(c => ({ x: c.x, y: c.y, originalHex: c.hex, originalPalPos: c.palPos || '' }));
    applyMappingAndRender(p, parsed.format === 'arknights_draw' ? 'arknights_draw' : 'arkn-24x24');
});

function updatePreviewTransform() {
    previewCanvas.style.transform = `translate(-50%, -50%) translate(${previewPanX}px, ${previewPanY}px) scale(${previewScale})`;
}

function calculateInitialPreviewTransform() {
    const rect = previewContainer.getBoundingClientRect();
    const w = rect.width || previewContainer.clientWidth;
    const h = rect.height || previewContainer.clientHeight;
    if (!w || !h || !previewCanvas.width || !previewCanvas.height) return;

    previewScale = Math.min(w / previewCanvas.width, h / previewCanvas.height);
    previewPanX = 0;
    previewPanY = 0;
    updatePreviewTransform();
}

function drawCellsOnPreview(cols, rows, cells) {
    const CS = 16;
    previewCanvas.width = cols * CS;
    previewCanvas.height = rows * CS;
    const pCtx = previewCanvas.getContext('2d');
    pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    pCtx.fillStyle = '#FFFFFF';
    pCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    cells.filter(c => c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows).forEach(c => {
        pCtx.fillStyle = c.hex || '#FFFFFF';
        pCtx.fillRect(c.x * CS, c.y * CS, CS, CS);
        if (showPreviewGrid) {
            pCtx.strokeStyle = 'rgba(0,0,0,0.15)';
            pCtx.lineWidth = 1;
            pCtx.strokeRect(c.x * CS, c.y * CS, CS, CS);
        }
    });
}

function redrawPreviewFromCache() {
    if (currentPreviewCells.length) drawCellsOnPreview(currentPreviewCols, currentPreviewRows, currentPreviewCells);
}

function renderPreviewCanvas(cols, rows, cells) {
    currentPreviewCols = cols; currentPreviewRows = rows; currentPreviewCells = cells;
    drawCellsOnPreview(cols, rows, cells);
    requestAnimationFrame(() => {
        requestAnimationFrame(calculateInitialPreviewTransform);
    });
}

resetPreviewBtn.addEventListener('click', () => {
    requestAnimationFrame(calculateInitialPreviewTransform);
});

if (window.ResizeObserver) {
    new ResizeObserver(() => {
        if (currentPreviewCells.length && previewPanX === 0 && previewPanY === 0) {
            calculateInitialPreviewTransform();
        }
    }).observe(previewContainer);
}

previewContainer.addEventListener('pointerdown', e => {
    previewContainer.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
        isPreviewDragging = true;
        previewStartX = e.clientX - previewPanX;
        previewStartY = e.clientY - previewPanY;
    } else if (activePointers.size === 2) {
        isPreviewDragging = false;
        const pts = [...activePointers.values()];
        initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        initialPinchScale = previewScale;
    }
});

previewContainer.addEventListener('pointermove', e => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1 && isPreviewDragging) {
        previewPanX = e.clientX - previewStartX;
        previewPanY = e.clientY - previewStartY;
        updatePreviewTransform();
    } else if (activePointers.size === 2) {
        const pts = [...activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (initialPinchDist > 0) {
            const zf = dist / initialPinchDist;
            previewScale = Math.min(Math.max(initialPinchScale * zf, 0.2), 10);
            updatePreviewTransform();
        }
    }
});

function handlePointerUp(e) {
    if (previewContainer.hasPointerCapture(e.pointerId)) previewContainer.releasePointerCapture(e.pointerId);
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) initialPinchDist = 0;
    if (activePointers.size === 1) {
        const r = [...activePointers.values()][0];
        isPreviewDragging = true;
        previewStartX = r.x - previewPanX;
        previewStartY = r.y - previewPanY;
    } else isPreviewDragging = false;
}
previewContainer.addEventListener('pointerup', handlePointerUp);
previewContainer.addEventListener('pointercancel', handlePointerUp);

previewContainer.addEventListener('wheel', e => {
    e.preventDefault();
    const zf = e.deltaY < 0 ? 1.1 : 0.9;
    previewScale = Math.min(Math.max(previewScale * zf, 0.2), 10);
    updatePreviewTransform();
}, { passive: false });
