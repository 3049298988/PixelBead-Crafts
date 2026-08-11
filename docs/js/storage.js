const STORAGE_KEY = 'bead_tool_settings_v1';

// 集中管理所有默认配置项
export const DEFAULT_SETTINGS = {
    cols: 24,
    rows: 24,
    handleSize: 16,
    allowOutOfBounds: false,
    samplingMethod: 'center',
    paletteJson: '',
    fileNameRule: 'pixelbead_{time}',
    pngWidth: 576,
    pngHeight: 576,
    showPreviewGrid: false
};

export function saveSettingsToStorage(extra = {}) {
    const settings = {
        cols: document.getElementById('colsInput')?.value ?? DEFAULT_SETTINGS.cols,
        rows: document.getElementById('rowsInput')?.value ?? DEFAULT_SETTINGS.rows,
        handleSize: document.getElementById('handleSizeInput')?.value ?? DEFAULT_SETTINGS.handleSize,
        allowOutOfBounds: document.getElementById('allowOutOfBounds')?.checked ?? DEFAULT_SETTINGS.allowOutOfBounds,
        samplingMethod: document.getElementById('samplingMethod')?.value ?? DEFAULT_SETTINGS.samplingMethod,
        paletteJson: document.getElementById('paletteInput')?.value ?? DEFAULT_SETTINGS.paletteJson,
        fileNameRule: document.getElementById('fileNameRule')?.value ?? DEFAULT_SETTINGS.fileNameRule,
        pngWidth: document.getElementById('pngWidth')?.value ?? DEFAULT_SETTINGS.pngWidth,
        pngHeight: document.getElementById('pngHeight')?.value ?? DEFAULT_SETTINGS.pngHeight,
        ...extra
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function loadSettingsFromStorage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { ...DEFAULT_SETTINGS };
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}
