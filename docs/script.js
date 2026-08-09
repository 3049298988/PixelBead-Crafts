const STORAGE_KEY = 'bead_tool_settings_v1';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

let img = new Image();
let grid = { x: 50, y: 50, w: 400, h: 400, cols: 24, rows: 24 };
let isDragging = false;
let dragType = null; 
let dragStartX, dragStartY;
let initialGrid;

let handleRadius = 16;
let rawSampledCells = [];
let colorOverrides = {};

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
        const settings = JSON.parse(saved);
        if (settings.cols) document.getElementById('colsInput').value = settings.cols;
        if (settings.rows) document.getElementById('rowsInput').value = settings.rows;
        if (settings.handleSize) syncHandleSize(settings.handleSize);
        if (settings.allowOutOfBounds !== undefined) document.getElementById('allowOutOfBounds').checked = settings.allowOutOfBounds;
        if (settings.samplingMethod) document.getElementById('samplingMethod').value = settings.samplingMethod;
        if (settings.paletteJson) document.getElementById('paletteInput').value = settings.paletteJson;

        grid.cols = parseInt(document.getElementById('colsInput').value) || 24;
        grid.rows = parseInt(document.getElementById('rowsInput').value) || 24;
        enforceSquareCells();
        return true;
    } catch (e) {
        console.error('加载本地设置失败', e);
        return false;
    }
}

function fetchOnlinePalette() {
    fetch('./色板.json?t=' + Date.now())
        .then(response => {
            if (!response.ok) throw new Error('网络请求错误');
            return response.json();
        })
        .then(data => {
            document.getElementById('paletteInput').value = JSON.stringify(data, null, 4);
            saveSettingsToStorage();
            alert('在线色板更新完成！');
        })
        .catch(() => {
            alert('加载 ./色板.json 失败，请检查文件是否存在。');
        });
}

document.getElementById('onlineUpdateBtn').addEventListener('click', fetchOnlinePalette);

window.addEventListener('DOMContentLoaded', () => {
    const loaded = loadSettingsFromStorage();
    if (!loaded || !document.getElementById('paletteInput').value.trim() || document.getElementById('paletteInput').value === '[]') {
        fetchOnlinePalette();
    }

    const autoSaveInputs = ['colsInput', 'rowsInput', 'allowOutOfBounds', 'samplingMethod', 'paletteInput'];
    autoSaveInputs.forEach(id => {
        document.getElementById(id).addEventListener('change', saveSettingsToStorage);
    });
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
handleRange.addEventListener('input', (e) => { syncHandleSize(e.target.value); saveSettingsToStorage(); });
handleInput.addEventListener('input', (e) => { syncHandleSize(e.target.value); saveSettingsToStorage(); });

document.getElementById('paletteFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const parsed = JSON.parse(event.target.result);
            document.getElementById('paletteInput').value = JSON.stringify(parsed, null, 4);
            saveSettingsToStorage();
        } catch (err) {
            alert('色板 JSON 解析失败');
        }
    };
    reader.readAsText(file);
});

function enforceSquareCells() {
    if (grid.cols > 0 && grid.rows > 0) {
        grid.h = grid.w * (grid.rows / grid.cols);
    }
}

document.getElementById('colsInput').addEventListener('change', (e) => { 
    grid.cols = Math.max(1, parseInt(e.target.value) || 1); 
    enforceSquareCells();
    clampGridBounds();
    draw(); 
});
document.getElementById('rowsInput').addEventListener('change', (e) => { 
    grid.rows = Math.max(1, parseInt(e.target.value) || 1); 
    enforceSquareCells();
    clampGridBounds();
    draw(); 
});

document.getElementById('allowOutOfBounds').addEventListener('change', () => {
    clampGridBounds();
    draw();
});

function clampGridBounds() {
    const allowOut = document.getElementById('allowOutOfBounds').checked;
    if (allowOut || !img.src) return;

    const ratio = grid.rows / grid.cols;

    if (grid.w > img.width) {
        grid.w = img.width;
        grid.h = grid.w * ratio;
    }
    if (grid.h > img.height) {
        grid.h = img.height;
        grid.w = grid.h / ratio;
    }

    grid.x = Math.max(0, Math.min(grid.x, img.width - grid.w));
    grid.y = Math.max(0, Math.min(grid.y, img.height - grid.h));
}

document.getElementById('imageInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        img.onload = function() {
            canvas.width = img.width;
            canvas.height = img.height;
            
            offscreenCanvas.width = img.width;
            offscreenCanvas.height = img.height;
            offscreenCtx.drawImage(img, 0, 0);

            const imgRatio = img.width / img.height;
            const gridRatio = grid.cols / grid.rows;

            if (Math.abs(imgRatio - gridRatio) < 0.005) {
                grid.x = 0;
                grid.y = 0;
                grid.w = img.width;
                grid.h = img.height;
            } else {
                const minEdge = Math.min(img.width, img.height);
                grid.w = minEdge * 0.8;
                enforceSquareCells();
                grid.x = (img.width - grid.w) / 2;
                grid.y = (img.height - grid.h) / 2;
                clampGridBounds();
            }
            draw();
        }
        img.src = event.target.result;
    }
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

    ctx.fillStyle = 'rgba(79, 70, 229, 0.12)';
    ctx.fillRect(grid.x, grid.y, grid.w, grid.h);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(1, canvas.width / 900);
    ctx.beginPath();
    
    const cellW = grid.w / grid.cols;
    const cellH = grid.h / grid.rows;
    
    for(let i = 0; i <= grid.cols; i++) {
        ctx.moveTo(grid.x + i * cellW, grid.y);
        ctx.lineTo(grid.x + i * cellW, grid.y + grid.h);
    }
    for(let i = 0; i <= grid.rows; i++) {
        ctx.moveTo(grid.x, grid.y + i * cellH);
        ctx.lineTo(grid.x + grid.w, grid.y + i * cellH);
    }
    ctx.stroke();

    const handles = getHandles();
    for(let key in handles) {
        ctx.beginPath();
        ctx.arc(handles[key].x, handles[key].y, handleRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#4f46e5';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, handleRadius / 4);
        ctx.stroke();
    }
}

function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

canvas.addEventListener('pointerdown', function(e) {
    if (!img.src) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    const handles = getHandles();
    dragType = null;

    const hitThreshold = handleRadius * 1.5;
    for(let key in handles) {
        if(Math.hypot(pt.x - handles[key].x, pt.y - handles[key].y) < hitThreshold) {
            dragType = key;
            break;
        }
    }

    if(!dragType) {
        if(pt.x > grid.x && pt.x < grid.x + grid.w && pt.y > grid.y && pt.y < grid.y + grid.h) {
            dragType = 'all';
        }
    }

    if(dragType) {
        isDragging = true;
        dragStartX = pt.x;
        dragStartY = pt.y;
        initialGrid = { ...grid };
    }
});

canvas.addEventListener('pointermove', function(e) {
    if(!isDragging) return;
    const pt = getCanvasPoint(e);
    const dx = pt.x - dragStartX;
    const dy = pt.y - dragStartY;
    const ratio = grid.rows / grid.cols;

    if (dragType === 'all') {
        grid.x = initialGrid.x + dx;
        grid.y = initialGrid.y + dy;
    } else if (dragType === 'br' || dragType === 'r') {
        grid.w = Math.max(30, initialGrid.w + dx);
        grid.h = grid.w * ratio;
    } else if (dragType === 'bl' || dragType === 'l') {
        const newW = Math.max(30, initialGrid.w - dx);
        grid.x = initialGrid.x + (initialGrid.w - newW);
        grid.w = newW;
        grid.h = grid.w * ratio;
    } else if (dragType === 'tr' || dragType === 't') {
        grid.w = Math.max(30, initialGrid.w + dx);
        grid.h = grid.w * ratio;
        grid.y = initialGrid.y + (initialGrid.h - grid.h);
    } else if (dragType === 'tl') {
        const newW = Math.max(30, initialGrid.w - dx);
        grid.x = initialGrid.x + (initialGrid.w - newW);
        grid.w = newW;
        grid.h = grid.w * ratio;
        grid.y = initialGrid.y + (initialGrid.h - grid.h);
    } else if (dragType === 'b') {
        grid.h = Math.max(30, initialGrid.h + dy);
        grid.w = grid.h / ratio;
    }

    clampGridBounds();
    draw();
});

canvas.addEventListener('pointerup', function(e) {
    if (isDragging) {
        canvas.releasePointerCapture(e.pointerId);
        isDragging = false;
    }
});

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function getColorDistance(rgb1, rgb2) {
    return Math.sqrt((rgb1.r - rgb2.r)**2 + (rgb1.g - rgb2.g)**2 + (rgb1.b - rgb2.b)**2);
}

function getClosestPaletteColor(r, g, b, palette) {
    let minDistance = Infinity;
    let closest = null;
    let targetRgb = { r, g, b };
    for (let item of palette) {
        let pRgb = hexToRgb(item.hex);
        if (!pRgb) continue;
        let dist = getColorDistance(targetRgb, pRgb);
        if (dist < minDistance) {
            minDistance = dist;
            closest = item;
        }
    }
    return closest;
}

function sampleCellColor(startX, startY, w, h, method, palette) {
    if (method === 'center') {
        let px = Math.floor(startX + w / 2);
        let py = Math.floor(startY + h / 2);
        if (px < 0 || py < 0 || px >= offscreenCanvas.width || py >= offscreenCanvas.height) return null;
        const p = offscreenCtx.getImageData(px, py, 1, 1).data;
        if (p[3] === 0) return null;
        return getClosestPaletteColor(p[0], p[1], p[2], palette);
    } 
    else if (method === '4point') {
        const points = [
            [startX + w * 0.25, startY + h * 0.25],
            [startX + w * 0.75, startY + h * 0.25],
            [startX + w * 0.25, startY + h * 0.75],
            [startX + w * 0.75, startY + h * 0.75]
        ];
        let tr = 0, tg = 0, tb = 0, count = 0;
        for (let pt of points) {
            let px = Math.floor(pt[0]);
            let py = Math.floor(pt[1]);
            if (px >= 0 && py >= 0 && px < offscreenCanvas.width && py < offscreenCanvas.height) {
                let p = offscreenCtx.getImageData(px, py, 1, 1).data;
                if (p[3] > 0) {
                    tr += p[0]; tg += p[1]; tb += p[2];
                    count++;
                }
            }
        }
        if (count === 0) return null;
        return getClosestPaletteColor(tr / count, tg / count, tb / count, palette);
    }
    else if (method === 'average') {
        let tr = 0, tg = 0, tb = 0, count = 0;
        let stepX = Math.max(1, w / 5);
        let stepY = Math.max(1, h / 5);
        for (let x = startX + stepX / 2; x < startX + w; x += stepX) {
            for (let y = startY + stepY / 2; y < startY + h; y += stepY) {
                let px = Math.floor(x);
                let py = Math.floor(y);
                if (px >= 0 && py >= 0 && px < offscreenCanvas.width && py < offscreenCanvas.height) {
                    let p = offscreenCtx.getImageData(px, py, 1, 1).data;
                    if (p[3] > 0) {
                        tr += p[0]; tg += p[1]; tb += p[2];
                        count++;
                    }
                }
            }
        }
        if (count === 0) return null;
        return getClosestPaletteColor(tr / count, tg / count, tb / count, palette);
    }
    else if (method === 'majority') {
        let counts = {};
        let stepX = Math.max(1, w / 4);
        let stepY = Math.max(1, h / 4);
        for (let x = startX + stepX / 2; x < startX + w; x += stepX) {
            for (let y = startY + stepY / 2; y < startY + h; y += stepY) {
                let px = Math.floor(x);
                let py = Math.floor(y);
                if (px >= 0 && py >= 0 && px < offscreenCanvas.width && py < offscreenCanvas.height) {
                    let p = offscreenCtx.getImageData(px, py, 1, 1).data;
                    if (p[3] > 0) {
                        let matched = getClosestPaletteColor(p[0], p[1], p[2], palette);
                        if (matched) {
                            let key = matched.hex;
                            counts[key] = (counts[key] || 0) + 1;
                        }
                    }
                }
            }
        }
        let maxCount = -1;
        let bestHex = null;
        for (let hex in counts) {
            if (counts[hex] > maxCount) {
                maxCount = counts[hex];
                bestHex = hex;
            }
        }
        if (!bestHex) return null;
        for (let item of palette) {
            if (item.hex.toUpperCase() === bestHex.toUpperCase()) return item;
        }
    }
    return null;
}

document.getElementById('generateBtn').addEventListener('click', function() {
    if (!img.src) {
        alert('请先上传图片');
        return;
    }

    let palette = [];
    try {
        palette = JSON.parse(document.getElementById('paletteInput').value);
    } catch (e) {
        alert('色板 JSON 格式错误');
        return;
    }

    const method = document.getElementById('samplingMethod').value;
    const cellW = grid.w / grid.cols;
    const cellH = grid.h / grid.rows;
    
    rawSampledCells = [];
    colorOverrides = {};

    for (let y = 0; y < grid.rows; y++) {
        for (let x = 0; x < grid.cols; x++) {
            const startX = grid.x + x * cellW;
            const startY = grid.y + y * cellH;
            
            const matched = sampleCellColor(startX, startY, cellW, cellH, method, palette);
            if (matched) {
                rawSampledCells.push({
                    x: x,
                    y: y,
                    originalHex: matched.hex.toUpperCase(),
                    originalPalPos: `第${matched.row}行第${matched.col}列`
                });
            }
        }
    }

    buildColorMappingList(palette);
    applyMappingAndRender(palette);
});

function buildColorMappingList(palette) {
    const listContainer = document.getElementById('colorMappingList');
    const mappingGroup = document.getElementById('colorMappingGroup');
    listContainer.innerHTML = '';

    const colorCounts = {};
    rawSampledCells.forEach(cell => {
        colorCounts[cell.originalHex] = (colorCounts[cell.originalHex] || 0) + 1;
    });

    const uniqueHexes = Object.keys(colorCounts);
    if (uniqueHexes.length === 0) {
        mappingGroup.style.display = 'none';
        return;
    }

    mappingGroup.style.display = 'flex';

    uniqueHexes.forEach(origHex => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'color-mapping-item';

        const origItem = palette.find(p => p.hex.toUpperCase() === origHex);
        const posText = origItem ? `第${origItem.row}行第${origItem.col}列` : '';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'color-info';
        infoDiv.innerHTML = `
            <div class="color-badge" style="background:${origHex};"></div>
            <span>${origHex} (${posText}) - <b>${colorCounts[origHex]}格</b></span>
        `;

        const select = document.createElement('select');
        palette.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.hex.toUpperCase();
            opt.textContent = `${p.hex.toUpperCase()} (第${p.row}行第${p.col}列)`;
            if (p.hex.toUpperCase() === origHex) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });

        select.addEventListener('change', (e) => {
            colorOverrides[origHex] = e.target.value;
            applyMappingAndRender(palette);
        });

        itemDiv.appendChild(infoDiv);
        itemDiv.appendChild(select);
        listContainer.appendChild(itemDiv);
    });
}

function applyMappingAndRender(palette) {
    let seq = 1;
    const finalCells = rawSampledCells.map(cell => {
        const currentHex = colorOverrides[cell.originalHex] || cell.originalHex;
        const matchedPaletteItem = palette.find(p => p.hex.toUpperCase() === currentHex);
        
        return {
            x: cell.x,
            y: cell.y,
            seq: seq++,
            region: 1,
            hex: currentHex,
            palPos: matchedPaletteItem ? `第${matchedPaletteItem.row}行第${matchedPaletteItem.col}列` : cell.originalPalPos
        };
    });

    const outputData = {
        size: grid.cols, 
        cells: finalCells
    };

    document.getElementById('outputJson').value = JSON.stringify(outputData, null, 0);
}

document.getElementById('copyJsonBtn').addEventListener('click', function() {
    const jsonText = document.getElementById('outputJson').value;
    if (!jsonText) {
        alert('暂无可复制的转换结果');
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(jsonText).then(() => {
            showCopySuccess();
        }).catch(() => {
            fallbackCopy(jsonText);
        });
    } else {
        fallbackCopy(jsonText);
    }
});

function fallbackCopy(text) {
    const textarea = document.getElementById('outputJson');
    textarea.select();
    try {
        document.execCommand('copy');
        showCopySuccess();
    } catch (err) {
        alert('复制失败，请手动选择复制');
    }
}

function showCopySuccess() {
    const btn = document.getElementById('copyJsonBtn');
    const origText = btn.textContent;
    btn.textContent = '复制成功！';
    btn.style.background = '#10b981';
    setTimeout(() => {
        btn.textContent = origText;
        btn.style.background = 'var(--primary)';
    }, 1500);
}
