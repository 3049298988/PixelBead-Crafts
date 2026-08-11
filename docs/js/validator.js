import { detectAndParseJson } from './converter.js';

export function validateOutputJson() {
    const text = document.getElementById('outputJson').value.trim();
    if (!text) {
        alert('校验错误：转换结果输入框内容为空！\n请输入json格式或点击\n“生成与采样分析”按钮 生成数据\n导出 arkn-24x24 / 导出 arknights_draw\n可互相转换\n按钮下方链接为对应格式网站');
        return false;
    }
    const parsed = detectAndParseJson(text);
    if (!parsed || !parsed.cells || !parsed.cells.length) {
        alert('校验错误：输入框内 JSON 数据格式非法或不包含有效单元格！');
        return false;
    }
    return parsed;
}