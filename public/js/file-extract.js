// 把上传的文件转成纯文本，交给 tools.js 里现成的单词表解析器
//
// PDF  -> pdf.js 提取文字层；没有文字层（扫描件）时自动回退到 OCR
// DOCX -> mammoth 转 HTML 后取表格与段落
// DOC  -> 先嗅探真实格式：伪 docx / RTF 能处理，老式二进制 doc 给出明确提示
// 图片 -> tesseract.js OCR
//
// 第三方库全部懒加载：只有用户真的上传了文件才下载，不拖慢正常浏览

const vendor = path => new URL(`../vendor/${path}`, import.meta.url).href;

// OCR 引擎体积较大，页面里不需要预先加载
const OCR_MAX_PDF_PAGES = 20;
const OCR_PDF_SCALE = 2;

let statusSink = () => {};

function say(text) {
    statusSink(text);
}

/* ---------------- 按需加载 ---------------- */

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('组件加载失败，请检查网络后重试'));
        document.head.appendChild(el);
    });
}

let pdfjsPromise = null;
function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import(vendor('pdf.min.mjs')).then(mod => {
            mod.GlobalWorkerOptions.workerSrc = vendor('pdf.worker.min.mjs');
            return mod;
        });
    }
    return pdfjsPromise;
}

let mammothPromise = null;
function loadMammoth() {
    if (!mammothPromise) {
        mammothPromise = loadScript(vendor('mammoth.browser.min.js')).then(() => {
            if (!window.mammoth) throw new Error('Word 解析组件加载失败');
            return window.mammoth;
        });
    }
    return mammothPromise;
}

let tesseractPromise = null;
function loadTesseract() {
    if (!tesseractPromise) {
        tesseractPromise = import(vendor('tesseract.esm.min.js')).then(mod => mod.default);
    }
    return tesseractPromise;
}

const OCR_STATUS = {
    'loading tesseract core': '加载识别核心…',
    'initializing tesseract': '初始化识别引擎…',
    'loading language traineddata': '加载识别包…',
    'initializing api': '准备识别…',
    'recognizing text': '识别文字中'
};

const OCR_LANG_LABEL = { chi_sim: '中文', eng: '英文' };

// 每种语言各缓存一个 worker：单词表用 chi_sim（本身含拉丁字母），错题本截图用 eng
const ocrWorkers = new Map();

function getOcrWorker(lang = 'chi_sim') {
    if (!ocrWorkers.has(lang)) {
        const promise = (async () => {
            const label = OCR_LANG_LABEL[lang] || lang;
            say(`正在加载 OCR 引擎（${label}，首次约 4MB）…`);
            const Tesseract = await loadTesseract();
            const worker = await Tesseract.createWorker(lang, 1, {
                workerPath: vendor('tesseract-worker.min.js'),
                corePath: vendor('tesseract-core-simd-lstm.wasm.js'),
                langPath: vendor('tesseract-lang/'),
                gzip: false,
                logger: msg => {
                    if (!msg || !msg.status) return;
                    const text = OCR_STATUS[msg.status] || msg.status;
                    if (msg.status === 'recognizing text' && typeof msg.progress === 'number') {
                        say(`${text} ${Math.round(msg.progress * 100)}%`);
                    } else {
                        say(`${text}…`);
                    }
                }
            });

            // 单词表 / 题目都是整齐的文本块，单块版面模式比默认的自动分栏更准
            await worker.setParameters({
                tessedit_pageseg_mode: '6',
                preserve_interword_spaces: '1'
            });

            return worker;
        })().catch(err => {
            ocrWorkers.delete(lang);
            if (lang === 'eng') {
                throw new Error('英文识别包不可用，请把 eng.traineddata 放进 public/vendor/tesseract-lang/');
            }
            throw err;
        });

        ocrWorkers.set(lang, promise);
    }
    return ocrWorkers.get(lang);
}

// 识别一张图片里的文字；lang 决定用哪个识别包（默认中文，含拉丁字母）
export async function ocrImage(file, { lang = 'chi_sim', onStatus } = {}) {
    if (onStatus) statusSink = onStatus;

    const worker = await getOcrWorker(lang);
    say('识别图片中的文字…');
    const { data } = await worker.recognize(file);

    if (!data.text || !data.text.trim()) {
        throw new Error('没有从图片里识别出文字，换一张更清晰、文字更大的图试试');
    }
    return data.text;
}

/* ---------------- PDF ---------------- */

// 把一行里的文本片段按位置拼起来：间隙大就补空格，避免 "app le" 这类
function joinLine(items) {
    let line = '';
    let prevEnd = null;

    for (const item of items) {
        const x = item.transform[4];
        const height = Math.abs(item.transform[3]) || item.height || 10;

        if (prevEnd !== null && x - prevEnd > height * 0.15) line += ' ';
        line += item.str;
        prevEnd = x + (item.width || 0);
    }

    return line;
}

// 先按纵坐标排序再按横坐标，让「单词 | 释义」落在同一行
function textItemsToLines(rawItems) {
    const items = rawItems.filter(item => item.str && item.str.trim());

    items.sort((a, b) => {
        const dy = b.transform[5] - a.transform[5];
        return Math.abs(dy) > 2 ? dy : a.transform[4] - b.transform[4];
    });

    const lines = [];
    let current = [];
    let currentY = null;

    for (const item of items) {
        const y = item.transform[5];
        const height = Math.abs(item.transform[3]) || item.height || 10;

        if (currentY === null || Math.abs(y - currentY) > height * 0.5) {
            if (current.length) lines.push(joinLine(current));
            current = [];
            currentY = y;
        }
        current.push(item);
    }
    if (current.length) lines.push(joinLine(current));

    return lines.map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

async function renderPageToCanvas(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
}

// 扫描件没有文字层，只能把每页画成图再 OCR
async function ocrPdfPages(doc) {
    const worker = await getOcrWorker();
    const total = Math.min(doc.numPages, OCR_MAX_PDF_PAGES);
    const pages = [];

    for (let i = 1; i <= total; i++) {
        say(`扫描件 OCR：第 ${i}/${total} 页…`);
        const page = await doc.getPage(i);
        const canvas = await renderPageToCanvas(page, OCR_PDF_SCALE);
        const { data } = await worker.recognize(canvas);
        pages.push(data.text || '');
    }

    return pages.join('\n');
}

async function extractPdf(file) {
    say('读取 PDF…');
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;

    const pages = [];
    let charCount = 0;

    for (let i = 1; i <= doc.numPages; i++) {
        say(`解析 PDF 第 ${i}/${doc.numPages} 页…`);
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = textItemsToLines(content.items);
        charCount += text.replace(/\s/g, '').length;
        pages.push(text);
    }

    // 几乎没有文字，说明是扫描件
    if (charCount < 20) {
        const limited = doc.numPages > OCR_MAX_PDF_PAGES;
        const text = await ocrPdfPages(doc);
        return {
            text,
            note: limited
                ? `扫描版 PDF，已 OCR 前 ${OCR_MAX_PDF_PAGES} 页（共 ${doc.numPages} 页）`
                : '扫描版 PDF，已用 OCR 识别'
        };
    }

    return { text: pages.join('\n') };
}

/* ---------------- Word ---------------- */

function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lines = [];

    const clean = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const blocks = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'];

    function visit(el) {
        for (const child of el.children) {
            const tag = child.tagName.toLowerCase();

            if (tag === 'table') {
                // 表格是最理想的格式：一行两个单元格正好是「单词 + 释义」
                for (const row of child.querySelectorAll('tr')) {
                    const cells = [...row.children].map(clean).filter(Boolean);
                    if (cells.length) lines.push(cells.join('\t'));
                }
            } else if (blocks.includes(tag)) {
                const text = clean(child);
                if (text) lines.push(text);
            } else {
                visit(child);
            }
        }
    }

    visit(doc.body);
    return lines.join('\n');
}

async function extractDocx(file) {
    say('解析 Word 文档…');
    const mammoth = await loadMammoth();
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const text = htmlToText(result.value || '');

    if (!text.trim()) {
        throw new Error('文档里没有可读取的文字；如果内容是图片，可以截图后上传图片识别');
    }
    return { text };
}

/* ---------------- RTF ---------------- */

// 去掉字体表 / 颜色表 / 图片等非正文分组（按配对花括号整体切除）
function stripRtfGroups(rtf) {
    // RTF 的目的地有两种写法：{\fonttbl ...} 与 {\*\fonttbl ...}
    const skip = /^\{(?:\\\*)?\\(?:fonttbl|colortbl|stylesheet|info|pict|object|themedata|datastore|latentstyles|listtable|listoverridetable|rsidtbl|generator|xmlnstbl)/;
    let out = '';
    let i = 0;

    while (i < rtf.length) {
        if (rtf[i] === '{') {
            let depth = 0;
            let j = i;
            for (; j < rtf.length; j++) {
                if (rtf[j] === '\\') {
                    j++;
                    continue;
                }
                if (rtf[j] === '{') depth++;
                else if (rtf[j] === '}' && --depth === 0) break;
            }
            const group = rtf.slice(i, j + 1);
            if (skip.test(group)) {
                i = j + 1;
                continue;
            }
        }
        out += rtf[i++];
    }
    return out;
}

function rtfToText(rtf) {
    let text = stripRtfGroups(rtf);

    text = text.replace(/\\'([0-9a-fA-F]{2})/g, (match, hex) => {
        const code = parseInt(hex, 16);
        return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '';
    });

    text = text.replace(/\\u(-?\d+)\s?\??/g, (match, num) => {
        let code = Number(num);
        if (code < 0) code += 65536;
        return String.fromCharCode(code);
    });

    text = text.replace(/\\(?:par|line|sect|page)\b/g, '\n');
    text = text.replace(/\\cell\b/g, '\t');
    text = text.replace(/\\row\b/g, '\n');
    text = text.replace(/\\[a-zA-Z]+-?\d*\s?/g, '');
    text = text.replace(/[{}]/g, '');

    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/* ---------------- 老式 .doc 嗅探 ---------------- */

async function extractLegacyDoc(file) {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());

    // PK 开头说明其实是 docx（或者 zip 容器）改了后缀
    if (head[0] === 0x50 && head[1] === 0x4b) {
        return extractDocx(file);
    }

    // OLE2 复合文档 = 真正的 Word 97-2003 二进制格式
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
        throw new Error('这是老式 Word 97-2003 的 .doc 格式，浏览器无法解析，请用 Word 打开后「另存为」.docx 再上传');
    }

    const headText = await file.slice(0, 256).text();
    if (/^\s*\{?\\rtf/i.test(headText)) {
        return { text: rtfToText(await file.text()), note: '按 RTF 文本解析' };
    }

    throw new Error('无法识别的 .doc 文件，请用 Word 另存为 .docx 后重试');
}

/* ---------------- 图片 ---------------- */

async function extractImage(file) {
    return { text: await ocrImage(file, { lang: 'chi_sim' }) };
}

/* ---------------- 对外入口 ---------------- */

export const ACCEPT = '.pdf,.doc,.docx,.rtf,.txt,.jpg,.jpeg,.png,.webp,.bmp';

export function fileKind(file) {
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';

    if (/\.pdf$/.test(name) || type === 'application/pdf') return 'pdf';
    if (/\.docx$/.test(name)) return 'docx';
    if (/\.doc$/.test(name)) return 'doc';
    if (/\.rtf$/.test(name)) return 'rtf';
    if (/\.txt$/.test(name) || type.startsWith('text/')) return 'text';
    if (/\.(png|jpe?g|webp|bmp|gif)$/.test(name) || type.startsWith('image/')) return 'image';
    return 'unknown';
}

export async function extractFile(file, onStatus = () => {}) {
    statusSink = onStatus;

    switch (fileKind(file)) {
        case 'pdf':
            return extractPdf(file);
        case 'docx':
            return extractDocx(file);
        case 'doc':
            return extractLegacyDoc(file);
        case 'rtf':
            say('解析 RTF 文档…');
            return { text: rtfToText(await file.text()) };
        case 'text':
            say('读取文本文件…');
            return { text: await file.text() };
        case 'image':
            return extractImage(file);
        default:
            throw new Error('不支持的文件类型，请上传 PDF、Word 或图片');
    }
}
