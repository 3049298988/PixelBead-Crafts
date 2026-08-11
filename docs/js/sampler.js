export function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export function getColorDistance(c1, c2) {
    return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2);
}

export function getClosestPaletteColor(r, g, b, palette) {
    let minDist = Infinity, best = null;
    for (let item of palette) {
        const rgb = hexToRgb(item.hex);
        if (!rgb) continue;
        const dist = getColorDistance({ r, g, b }, rgb);
        if (dist < minDist) { minDist = dist; best = item; }
    }
    return best;
}

export function sampleCellColor(sx, sy, w, h, method, palette, offscreenCanvas, offscreenCtx) {
    if (method === 'center') {
        const px = Math.floor(sx + w / 2), py = Math.floor(sy + h / 2);
        if (px < 0 || py < 0 || px >= offscreenCanvas.width || py >= offscreenCanvas.height) return null;
        const d = offscreenCtx.getImageData(px, py, 1, 1).data;
        return d[3] ? getClosestPaletteColor(d[0], d[1], d[2], palette) : null;
    } else if (method === '4point') {
        const pts = [
            [sx + w * 0.25, sy + h * 0.25], [sx + w * 0.75, sy + h * 0.25],
            [sx + w * 0.25, sy + h * 0.75], [sx + w * 0.75, sy + h * 0.75]
        ];
        let tr = 0, tg = 0, tb = 0, cnt = 0;
        for (const [px, py] of pts) {
            if (px < 0 || py < 0 || px >= offscreenCanvas.width || py >= offscreenCanvas.height) continue;
            const d = offscreenCtx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
            if (d[3]) { tr += d[0]; tg += d[1]; tb += d[2]; cnt++; }
        }
        return cnt ? getClosestPaletteColor(tr / cnt, tg / cnt, tb / cnt, palette) : null;
    } else if (method === 'average') {
        let tr = 0, tg = 0, tb = 0, cnt = 0;
        const sx2 = Math.max(1, w / 5), sy2 = Math.max(1, h / 5);
        for (let x = sx + sx2 / 2; x < sx + w; x += sx2) {
            for (let y = sy + sy2 / 2; y < sy + h; y += sy2) {
                const px = Math.floor(x), py = Math.floor(y);
                if (px < 0 || py < 0 || px >= offscreenCanvas.width || px >= offscreenCanvas.height) continue;
                const d = offscreenCtx.getImageData(px, py, 1, 1).data;
                if (d[3]) { tr += d[0]; tg += d[1]; tb += d[2]; cnt++; }
            }
        }
        return cnt ? getClosestPaletteColor(tr / cnt, tg / cnt, tb / cnt, palette) : null;
    } else if (method === 'majority') {
        const counts = {};
        const sx2 = Math.max(1, w / 4), sy2 = Math.max(1, h / 4);
        for (let x = sx + sx2 / 2; x < sx + w; x += sx2) {
            for (let y = sy + sy2 / 2; y < sy + h; y += sy2) {
                const px = Math.floor(x), py = Math.floor(y);
                if (px < 0 || py < 0 || px >= offscreenCanvas.width || py >= offscreenCanvas.height) continue;
                const d = offscreenCtx.getImageData(px, py, 1, 1).data;
                if (d[3]) {
                    const match = getClosestPaletteColor(d[0], d[1], d[2], palette);
                    if (match) counts[match.hex] = (counts[match.hex] || 0) + 1;
                }
            }
        }
        let bestHex = null, max = -1;
        for (const h in counts) if (counts[h] > max) { max = counts[h]; bestHex = h; }
        return bestHex ? palette.find(p => p.hex.toUpperCase() === bestHex.toUpperCase()) : null;
    }
    return null;
}