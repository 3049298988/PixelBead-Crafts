const STORAGE_KEY = 'bead_tool_settings_v1';

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
let grid = { x: 50, y: 50, w: 400, h: 400, cols: 24, rows: 24 };
let isDragging = false;
let dragType = null; 
let dragStartX, dragStartY;
let initialGrid;

let handleRadius = 16;
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
let showPreviewGrid = true;
let currentPreviewCells = [];
let currentPreviewCols = grid.cols;
let currentPreviewRows = grid.rows;

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

    function register(btn) {
        const text = btn.getAttribute('data-tooltip');
        if (!text) return;

        btn.addEventListener('mouseenter', () => show(btn, text));
        btn.addEventListener('mouseleave', hide);
        btn.addEventListener('touchstart', () => {
            longPressTimer = setTimeout(() => show(btn, text), 600);
        });
        btn.addEventListener('touchend', hide);
        btn.addEventListener('touchcancel', hide);
    }

    document.querySelectorAll('[data-tooltip]').forEach(register);
})();

function saveSettingsToStorage() {
    const settings = {
        cols: document.getElementById('colsInput').value,
        rows: document.getElementById('rowsInput').value,
        handleSize: document.getElementById('handleSizeInput').value,
        allowOutOfBounds: document.getElementById('allowOutOfBounds').checked,
        samplingMethod: document.getElementById('samplingMethod').value,
        paletteJson: document.getElementById('paletteInput').value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadSettingsFromStorage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    try {
        const s = JSON.parse(saved);
        if (s.cols) document.getElementById('colsInput').value = s.cols;
        if (s.rows) document.getElementById('rowsInput').value = s.rows;
        if (s.handleSize) syncHandleSize(s.handleSize);
        if (s.allowOutOfBounds !== undefined) document.getElementById('allowOutOfBounds').checked = s.allowOutOfBounds;
        if (s.samplingMethod) document.getElementById('samplingMethod').value = s.samplingMethod;
        if (s.paletteJson) document.getElementById('paletteInput').value = s.paletteJson;
        grid.cols = parseInt(document.getElementById('colsInput').value) || 24;
        grid.rows = parseInt(document.getElementById('rowsInput').value) || 24;
        enforceSquareCells();
        return true;
    } catch (e) { return false; }
}

function fetchOnlinePalette() {
    fetch('./色板.json?t=' + Date.now())
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            document.getElementById('paletteInput').value = JSON.stringify(data, null, 4);
            saveSettingsToStorage();
            paletteStatus.textContent = '✓ 当前使用在线色板';
            alert('在线色板更新完成！\n已缓存到浏览器存储');
        })
        .catch(() => alert('加载 ./色板.json 失败'));
}

document.getElementById('onlineUpdateBtn').addEventListener('click', fetchOnlinePalette);

window.addEventListener('DOMContentLoaded', () => {
    const loaded = loadSettingsFromStorage();
    const paletteInput = document.getElementById('paletteInput');
    if (!loaded || !paletteInput.value.trim() || paletteInput.value === '[]') {
        fetchOnlinePalette();
    } else {
        paletteStatus.textContent = '✓ 使用已保存的色板';
    }
    ['colsInput','rowsInput','allowOutOfBounds','samplingMethod','paletteInput'].forEach(id => {
        document.getElementById(id).addEventListener('change', saveSettingsToStorage);
    });
});

toggleGridBtn.addEventListener('click', () => {
    showPreviewGrid = !showPreviewGrid;
    toggleGridBtn.textContent = showPreviewGrid ? '⊞' : '⊟';
    redrawPreviewFromCache();
});

const handleRange = document.getElementById('handleSizeRange');
const handleInput = document.getElementById('handleSizeInput');
function syncHandleSize(val) {
    val = Math.max(8, Math.min(40, parseInt(val) || 16));
    handleRange.value = val;
    handleInput.value = val;
    handleRadius = val;
    draw();
}
handleRange.addEventListener('input', e => { syncHandleSize(e.target.value); saveSettingsToStorage(); });
handleInput.addEventListener('input', e => { syncHandleSize(e.target.value); saveSettingsToStorage(); });

document.getElementById('paletteFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            document.getElementById('paletteInput').value = JSON.stringify(JSON.parse(ev.target.result), null, 4);
            saveSettingsToStorage();
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
});
document.getElementById('rowsInput').addEventListener('change', e => {
    grid.rows = Math.max(1, parseInt(e.target.value) || 1);
    enforceSquareCells(); clampGridBounds(); draw();
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
    for (let i=0; i<=grid.cols; i++) { ctx.moveTo(grid.x+i*cw, grid.y); ctx.lineTo(grid.x+i*cw, grid.y+grid.h); }
    for (let i=0; i<=grid.rows; i++) { ctx.moveTo(grid.x, grid.y+i*ch); ctx.lineTo(grid.x+grid.w, grid.y+i*ch); }
    ctx.stroke();
    const handles = getHandles();
    for (let k in handles) {
        ctx.beginPath();
        ctx.arc(handles[k].x, handles[k].y, handleRadius, 0, 2*Math.PI);
        ctx.fillStyle = '#4f46e5';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, handleRadius/4);
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
    if (!dragType && pt.x>grid.x && pt.x<grid.x+grid.w && pt.y>grid.y && pt.y<grid.y+grid.h) dragType = 'all';
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
    else if (dragType === 'br' || dragType === 'r') { grid.w = Math.max(30, initialGrid.w+dx); grid.h = grid.w*ratio; }
    else if (dragType === 'bl' || dragType === 'l') { const nw = Math.max(30, initialGrid.w-dx); grid.x = initialGrid.x+(initialGrid.w-nw); grid.w = nw; grid.h = grid.w*ratio; }
    else if (dragType === 'tr' || dragType === 't') { grid.w = Math.max(30, initialGrid.w+dx); grid.h = grid.w*ratio; grid.y = initialGrid.y+(initialGrid.h-grid.h); }
    else if (dragType === 'tl') { const nw = Math.max(30, initialGrid.w-dx); grid.x = initialGrid.x+(initialGrid.w-nw); grid.w = nw; grid.h = grid.w*ratio; grid.y = initialGrid.y+(initialGrid.h-grid.h); }
    else if (dragType === 'b') { grid.h = Math.max(30, initialGrid.h+dy); grid.w = grid.h/ratio; }
    clampGridBounds();
    draw();
});
canvas.addEventListener('pointerup', function(e) {
    if (isDragging) { canvas.releasePointerCapture(e.pointerId); isDragging = false; }
});

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}
function getColorDistance(c1, c2) { return Math.sqrt((c1.r-c2.r)**2+(c1.g-c2.g)**2+(c1.b-c2.b)**2); }
function getClosestPaletteColor(r, g, b, palette) {
    let minDist = Infinity, best = null;
    for (let item of palette) {
        const rgb = hexToRgb(item.hex);
        if (!rgb) continue;
        const dist = getColorDistance({r,g,b}, rgb);
        if (dist < minDist) { minDist = dist; best = item; }
    }
    return best;
}
function sampleCellColor(sx, sy, w, h, method, palette) {
    if (method === 'center') {
        const px = Math.floor(sx+w/2), py = Math.floor(sy+h/2);
        if (px<0||py<0||px>=offscreenCanvas.width||py>=offscreenCanvas.height) return null;
        const d = offscreenCtx.getImageData(px,py,1,1).data;
        return d[3] ? getClosestPaletteColor(d[0],d[1],d[2],palette) : null;
    } else if (method === '4point') {
        const pts = [[sx+w*0.25,sy+h*0.25],[sx+w*0.75,sy+h*0.25],[sx+w*0.25,sy+h*0.75],[sx+w*0.75,sy+h*0.75]];
        let tr=0,tg=0,tb=0,cnt=0;
        for (const [px,py] of pts) {
            if (px<0||py<0||px>=offscreenCanvas.width||py>=offscreenCanvas.height) continue;
            const d = offscreenCtx.getImageData(Math.floor(px),Math.floor(py),1,1).data;
            if (d[3]) { tr+=d[0]; tg+=d[1]; tb+=d[2]; cnt++; }
        }
        return cnt ? getClosestPaletteColor(tr/cnt, tg/cnt, tb/cnt, palette) : null;
    } else if (method === 'average') {
        let tr=0,tg=0,tb=0,cnt=0;
        const sx2 = Math.max(1, w/5), sy2 = Math.max(1, h/5);
        for (let x=sx+sx2/2; x<sx+w; x+=sx2) {
            for (let y=sy+sy2/2; y<sy+h; y+=sy2) {
                const px=Math.floor(x), py=Math.floor(y);
                if (px<0||py<0||px>=offscreenCanvas.width||py>=offscreenCanvas.height) continue;
                const d = offscreenCtx.getImageData(px,py,1,1).data;
                if (d[3]) { tr+=d[0]; tg+=d[1]; tb+=d[2]; cnt++; }
            }
        }
        return cnt ? getClosestPaletteColor(tr/cnt, tg/cnt, tb/cnt, palette) : null;
    } else if (method === 'majority') {
        const counts = {};
        const sx2 = Math.max(1, w/4), sy2 = Math.max(1, h/4);
        for (let x=sx+sx2/2; x<sx+w; x+=sx2) {
            for (let y=sy+sy2/2; y<sy+h; y+=sy2) {
                const px=Math.floor(x), py=Math.floor(y);
                if (px<0||py<0||px>=offscreenCanvas.width||py>=offscreenCanvas.height) continue;
                const d = offscreenCtx.getImageData(px,py,1,1).data;
                if (d[3]) {
                    const match = getClosestPaletteColor(d[0],d[1],d[2],palette);
                    if (match) counts[match.hex] = (counts[match.hex]||0)+1;
                }
            }
        }
        let bestHex = null, max = -1;
        for (const h in counts) if (counts[h] > max) { max = counts[h]; bestHex = h; }
        return bestHex ? palette.find(p => p.hex.toUpperCase() === bestHex.toUpperCase()) : null;
    }
    return null;
}

document.getElementById('generateBtn').addEventListener('click', function() {
    if (!img.src) return alert('请先上传图片');
    let palette;
    try { palette = JSON.parse(document.getElementById('paletteInput').value); } catch { return alert('色板 JSON 格式错误'); }
    const method = document.getElementById('samplingMethod').value;
    const cw = grid.w / grid.cols, ch = grid.h / grid.rows;
    rawSampledCells = [];
    colorOverrides = {};
    for (let y=0; y<grid.rows; y++) {
        for (let x=0; x<grid.cols; x++) {
            const sx = grid.x + x*cw, sy = grid.y + y*ch;
            const match = sampleCellColor(sx, sy, cw, ch, method, palette);
            if (match) rawSampledCells.push({ x, y, originalHex: match.hex.toUpperCase(), originalPalPos: `第${match.row}行第${match.col}列` });
        }
    }
    buildColorMappingList(palette);
    applyMappingAndRender(palette, 'arkn-24x24');
});

function buildColorMappingList(palette) {
    const list = document.getElementById('colorMappingList');
    const group = document.getElementById('colorMappingGroup');
    list.innerHTML = '';
    const counts = {};
    rawSampledCells.forEach(c => counts[c.originalHex] = (counts[c.originalHex]||0)+1);
    const uniq = Object.keys(counts);
    if (!uniq.length) { group.style.display = 'none'; return; }
    group.style.display = 'flex';
    uniq.forEach(hex => {
        const div = document.createElement('div'); div.className = 'color-mapping-item';
        const item = palette.find(p => p.hex.toUpperCase() === hex);
        const info = document.createElement('div'); info.className = 'color-info';
        info.innerHTML = `<div class="color-badge" style="background:${hex};"></div><span>${hex} (${item?`第${item.row}行第${item.col}列`:''}) - <b>${counts[hex]}格</b></span>`;
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

function convertArknToDraw(obj) {
    const size = obj.size || grid.cols;
    const cells = obj.cells || [];
    
    let paletteObjects = [];
    try {
        const parsed = JSON.parse(document.getElementById('paletteInput').value);
        if (Array.isArray(parsed)) {
            paletteObjects = [...parsed].sort((a, b) => (a.index || 0) - (b.index || 0));
        }
    } catch (e) {
        paletteObjects = [];
    }

    const paletteList = paletteObjects.map(p => (p.hex || '').toUpperCase());

    const defaultIndex = 4;
    const dgrid = new Array(size * size).fill(defaultIndex);

    cells.forEach(c => {
        const hex = (c.hex || '#FFFFFF').toUpperCase();
        let colorId = paletteList.indexOf(hex) + 1;
        
        if (colorId < 1) {
            colorId = defaultIndex;
        }

        const pos = c.y * size + c.x;
        if (pos >= 0 && pos < dgrid.length) {
            dgrid[pos] = colorId;
        }
    });

    return {
        format: "arknights_draw-project",
        version: 1,
        gridSize: size,
        palette: paletteList,
        grid: dgrid,
        selected: 1,
        fileName: "arknights_draw",
        settings: {
            mode: "hybrid",
            contrast: 0,
            saturation: 0,
            showNumbers: true,
            showGrid: true
        },
        savedAt: new Date().toISOString()
    };
}

function applyMappingAndRender(palette, fmt='arkn-24x24') {
    let seq = 1;
    const cells = rawSampledCells.map(c => {
        const cur = colorOverrides[c.originalHex] || c.originalHex;
        const item = palette.find(p => p.hex.toUpperCase() === cur);
        return { x:c.x, y:c.y, seq:seq++, region: c.x<Math.floor(grid.cols/2)?1:2, hex:cur, palPos: item?`第${item.row}行第${item.col}列`:c.originalPalPos };
    });
    const data = { size:grid.cols, cells };
    const result = fmt==='arknights_draw' ? convertArknToDraw(data) : data;
    document.getElementById('outputJson').value = JSON.stringify(result, null, fmt==='arknights_draw'?2:0);
    renderPreviewCanvas(grid.cols, grid.rows, cells);
}

const EMPTY_JSON_TIP = `警告：文本框内暂无可转换的数据！\n\n【正确做法】\n1. 请先在上方选择图片并调整采样网格；\n2. 点击“采样生成 JSON”按钮生成数据；\n3. 或直接在文本框中粘贴有效 JSON 数据后再点击导出。`;

function handleExport(fmt) {
    const outputElem = document.getElementById('outputJson');
    const jsonVal = outputElem.value.trim();
    
    if (!jsonVal) {
        alert(EMPTY_JSON_TIP);
        return;
    }

    let p;
    try { 
        p = JSON.parse(document.getElementById('paletteInput').value); 
    } catch { 
        p = []; 
    }

    if (rawSampledCells.length > 0) {
        applyMappingAndRender(p, fmt);
    } else {
        try {
            const obj = JSON.parse(jsonVal);
            let cells = [];
            let cols = grid.cols;

            if (obj.format === 'arknights_draw-project' && Array.isArray(obj.grid) && Array.isArray(obj.palette)) {
                cols = obj.gridSize || 24;
                obj.grid.forEach((pi, i) => {
                    if (pi > 0 && obj.palette[pi - 1]) {
                        const x = i % cols, y = Math.floor(i / cols);
                        cells.push({ x, y, seq: cells.length + 1, region: x < Math.floor(cols / 2) ? 1 : 2, hex: obj.palette[pi - 1].toUpperCase(), palPos: '' });
                    }
                });
            } else if (Array.isArray(obj.cells)) {
                cols = obj.size || grid.cols;
                cells = obj.cells;
            }

            if (cells.length > 0) {
                rawSampledCells = cells.map(c => ({ x: c.x, y: c.y, originalHex: c.hex, originalPalPos: c.palPos || '' }));
                applyMappingAndRender(p, fmt);
            } else {
                alert('文本框中的 JSON 数据不包含有效的单元格信息！');
            }
        } catch (e) {
            alert('文本框中的内容不是合法的 JSON 格式，无法转换！');
        }
    }
}

const oldArknBtn = document.getElementById('exportArknBtn');
const oldDrawBtn = document.getElementById('exportDrawBtn');

const exportArknBtn = oldArknBtn.cloneNode(true);
const exportDrawBtn = oldDrawBtn.cloneNode(true);

oldArknBtn.parentNode.replaceChild(exportArknBtn, oldArknBtn);
oldDrawBtn.parentNode.replaceChild(exportDrawBtn, oldDrawBtn);

exportArknBtn.onclick = (e) => {
    e.preventDefault();
    handleExport('arkn-24x24');
};

exportDrawBtn.onclick = (e) => {
    e.preventDefault();
    handleExport('arknights_draw');
};

const outputJson = document.getElementById('outputJson');
outputJson.removeAttribute('readonly');
outputJson.removeAttribute('disabled');
outputJson.placeholder = `请输入json格式或点击“生成与采样分析”按钮生成数据\n导出 arkn-24x24 / 导出 arknights_draw 可互相转换\n按钮下方链接为对应格式网站`;

outputJson.addEventListener('input', function() {
    try {
        const obj = JSON.parse(this.value);
        let cols = obj.size || obj.gridSize || 24;
        let cells = [];
        if (obj.format === 'arknights_draw-project' && Array.isArray(obj.grid) && Array.isArray(obj.palette)) {
            const size = obj.gridSize || 24; cols = size;
            grid.cols = size; grid.rows = size;
            document.getElementById('colsInput').value = size;
            document.getElementById('rowsInput').value = size;
            obj.grid.forEach((pi, i) => {
                if (pi > 0 && obj.palette[pi - 1]) {
                    const x = i%size, y = Math.floor(i/size);
                    cells.push({x,y,seq:cells.length+1,region:x<Math.floor(size/2)?1:2,hex:obj.palette[pi - 1].toUpperCase(),palPos:''});
                }
            });
        } else if (Array.isArray(obj.cells)) {
            if (obj.size) { cols = obj.size; grid.cols=obj.size; grid.rows=obj.size; document.getElementById('colsInput').value=obj.size; document.getElementById('rowsInput').value=obj.size; }
            cells = obj.cells.map((c,i)=>({x:c.x||0,y:c.y||0,seq:c.seq||i+1,region:c.region||(c.x<Math.floor(cols/2)?1:2),hex:(c.hex||'#FFFFFF').toUpperCase(),palPos:c.palPos||''}));
        }
        if (cells.length) { rawSampledCells = cells.map(c=>({x:c.x,y:c.y,originalHex:c.hex,originalPalPos:c.palPos})); renderPreviewCanvas(grid.cols,grid.rows,cells); }
    } catch {}
});

document.getElementById('copyJsonBtn').addEventListener('click', () => {
    const text = document.getElementById('outputJson').value;
    if (!text) return alert('暂无可复制内容');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(showCopySuccess).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
});
function fallbackCopy(t) { const ta = document.getElementById('outputJson'); ta.select(); try { document.execCommand('copy'); showCopySuccess(); } catch { alert('复制失败'); } }
function showCopySuccess() {
    const btn = document.getElementById('copyJsonBtn'); const orig = btn.textContent;
    btn.textContent = '复制成功！'; btn.style.background = '#10b981';
    setTimeout(() => { btn.textContent = orig; btn.style.background = 'var(--primary)'; }, 1500);
}

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
    cells.filter(c => c.x>=0 && c.x<cols && c.y>=0 && c.y<rows).forEach(c => {
        pCtx.fillStyle = c.hex || '#FFFFFF';
        pCtx.fillRect(c.x*CS, c.y*CS, CS, CS);
        if (showPreviewGrid) {
            pCtx.strokeStyle = 'rgba(0,0,0,0.15)';
            pCtx.lineWidth = 1;
            pCtx.strokeRect(c.x*CS, c.y*CS, CS, CS);
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
