export function convertArknToDraw(obj, paletteInputJson, gridCols) {
    const size = obj.size || gridCols;
    const cells = obj.cells || [];
    
    let paletteObjects = [];
    try {
        const parsed = JSON.parse(paletteInputJson);
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
        if (colorId < 1) colorId = defaultIndex;

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

export function detectAndParseJson(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        const obj = JSON.parse(text.trim());
        if (!obj || typeof obj !== 'object') return null;
        
        if (obj.format === 'arknights_draw-project' && Array.isArray(obj.grid) && Array.isArray(obj.palette)) {
            const size = obj.gridSize || 24;
            const cells = [];
            obj.grid.forEach((pi, i) => {
                if (pi > 0 && obj.palette[pi - 1]) {
                    const x = i % size, y = Math.floor(i / size);
                    cells.push({
                        x, y,
                        seq: cells.length + 1,
                        region: x < Math.floor(size / 2) ? 1 : 2,
                        hex: obj.palette[pi - 1].toUpperCase(),
                        palPos: ''
                    });
                }
            });
            return { format: 'arknights_draw', cols: size, rows: size, cells, rawObj: obj };
        }
        
        if (Array.isArray(obj.cells)) {
            const size = obj.size || 24;
            const cells = obj.cells.map((c, i) => ({
                x: c.x || 0,
                y: c.y || 0,
                seq: c.seq || i + 1,
                region: c.region || (c.x < Math.floor(size / 2) ? 1 : 2),
                hex: (c.hex || '#FFFFFF').toUpperCase(),
                palPos: c.palPos || ''
            }));
            return { format: 'arkn-24x24', cols: size, rows: size, cells, rawObj: obj };
        }
    } catch (e) {
        return null;
    }
    return null;
}