// 错题文本解析：把一段题目文本拆成表单字段
// （卷名 / 题号 / 题干 / 选项 / 正确答案 / 我的答案 / 解析 / 题型）。
//
// 输入是截图 OCR 的结果，或用户直接粘贴 / 上传文件提取的原文。
// 纯函数，不碰 DOM 与网络，所以单独成模块，也方便直接测。

export const OPTION_LABELS = ['A', 'B', 'C', 'D'];

// 卷名：优先「2026年9月国际B卷」这类，其次「第3套」
const PAPER_MONTH = /\d{4}\s*年\s*\d{1,2}\s*月[^\d\n]{0,14}?卷/;
const PAPER_SET = /第\s*\d{1,3}\s*[套卷]/;
// 题号：行首的「2.」「2、」「(2)」，后面要跟内容
const NUMBER_RE = /(?:^|\n)\s*(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.、)）]\s+\S/;
// 选项：(A) xxx / A. xxx / A、xxx / A) xxx —— 也兼容「A xxx」这种字母后只跟空格的排版
const OPTION_RE = /^\s*[（(]?\s*([A-Da-d])\s*(?:[)）.、:：]\s*|\s+)(\S.*)$/;
// 「A: 正确…」「B：错误…」是逐项解析，不是选项
const ANALYSIS_ITEM = /^(?:正确|错误|对|错|解析|详解)/;
// 逐项解析的起始行（没有「解析」二字时靠它兜底）
const ANALYSIS_ITEM_LINE = /^\s*[A-Da-d]\s*[:：]\s*(?:正确|错误)/;
// 解析整段的起始标记
const ANALYSIS_MARK = /^\s*(?:答案解析|解析|详解|Explanation|为什么选)\s*[:：]?\s*(.*)$/i;
// 正确答案 / 参考答案 / Answer
const ANSWER_RE = /(?:正确答案|参考答案|标准答案|答案|Answer)\s*[:：]?\s*\n?\s*([A-D])(?![A-Za-z])/i;
// 我的答案：这个是用户自己选的那个，跟正确答案分开认
const MY_ANSWER_RE = /(?:我的答案|你的答案|所选答案|作答|我选)\s*[:：]?\s*\n?\s*([A-D])(?![A-Za-z])/;
// 题型：题型：篇章结构题（句子功能分析）
const CATEGORY_RE = /(?:题型|考点|类型)\s*[:：]\s*([^\n]+)/;
// 页眉特征：出现日期、年级、文法等，且带数字，才当页眉剔除
const HEADER_HINT = /(\d{4}\s*[-/年]\s*\d{1,2}|阅读文法|文法|高[一二三]年级|SAT\s*练习)/;
// 试卷阅读器上的固定标签 / 操作行，不该混进题干
const CHROME_LINE = /^(?:阅读|文法|阅读文法|隐藏答案|显示(?:做题)?答案|正确答案|参考答案|我的答案|你的答案|题型|考点|类型|解析|答案解析|详解)/;

function normalizePaper(raw) {
    return String(raw || '')
        .replace(/\s+/g, '')
        .replace(/[（(]\s*[）)]/g, '')
        .trim();
}

function detectPaper(text) {
    const t = String(text || '');
    const month = t.match(PAPER_MONTH);
    if (month) return normalizePaper(month[0]);
    const set = t.match(PAPER_SET);
    return set ? normalizePaper(set[0]) : '';
}

function detectNumber(text) {
    const m = String(text || '').match(NUMBER_RE);
    return m ? m[1] : '';
}

// 收 A–D 选项：只有在能找到一小段「A→B(→C→D)」紧挨着的序列时才认，
// 免得正文里「A 2020 年的研究…」这种句子被误当成选项
function parseOptions(text) {
    const lines = String(text || '').split(/\r?\n/);
    const candidates = [];

    lines.forEach((line, index) => {
        const m = line.match(OPTION_RE);
        if (!m) return;

        const value = m[2].trim();
        if (!value || ANALYSIS_ITEM.test(value)) return;
        candidates.push({ label: m[1].toUpperCase(), text: value, line: index });
    });

    for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].label !== 'A') continue;

        const picked = [candidates[i]];
        let cursor = i;
        for (const label of OPTION_LABELS.slice(1)) {
            const next = candidates.findIndex((item, j) =>
                j > cursor && item.label === label && item.line - candidates[cursor].line <= 6);
            if (next < 0) break;
            picked.push(candidates[next]);
            cursor = next;
        }

        // 至少要有 A、B 两个才算真的选项段
        if (picked.length >= 2) {
            return {
                options: picked.map(item => ({ label: item.label, text: item.text })),
                firstOptionLine: candidates[i].line
            };
        }
    }

    return { options: [], firstOptionLine: -1 };
}

// 题干：第一个选项行之前的文本，去掉页眉 / 阅读器标签 / 行首题号
function cleanStem(lines, paper) {
    const kept = lines.filter(raw => {
        const line = raw.trim();
        if (!line) return false;
        if (/^\d{1,4}$/.test(line)) return false;                       // 孤立的页码 / 题号行
        if (paper && line.replace(/\s+/g, '').includes(paper)) return false;
        if (HEADER_HINT.test(line) && /\d/.test(line)) return false;
        if (CHROME_LINE.test(line)) return false;                       // 阅读器标签 / 答案栏
        return true;
    });

    return kept
        .join('\n')
        // 每行行首的题号（「6. Which choice…」）都去掉，不只是整段最前面那一个
        .replace(/^\s*(?:第\s*)?\d{1,3}\s*(?:题)?\s*[.、)）]\s*/gm, '')
        .trim();
}

// 正确答案：先把「我的答案」那几行剔除，免得它里面的字母被当成正确答案
function detectAnswer(text) {
    let t = String(text || '');
    t = t.replace(/[^\n]*(?:我的答案|你的答案|所选答案)[^\n]*/g, ' ');
    const m = t.match(ANSWER_RE);
    return m ? m[1].toUpperCase() : '';
}

function detectMyAnswer(text) {
    const m = String(text || '').match(MY_ANSWER_RE);
    return m ? m[1].toUpperCase() : '';
}

// 解析：优先「解析 / 答案解析 / Explanation」后面的整段；
// 没有这个标记时，退一步从第一行「A: 正确…」这种逐项说明开始
function detectAnalysis(text) {
    const lines = String(text || '').split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(ANALYSIS_MARK);
        if (!m) continue;
        const rest = [m[1], ...lines.slice(i + 1)].join('\n').trim();
        if (rest) return rest;
    }

    const start = lines.findIndex(line => ANALYSIS_ITEM_LINE.test(line));
    return start >= 0 ? lines.slice(start).join('\n').trim() : '';
}

// 题型只取到第一个分隔符为止：「篇章结构题（句子功能分析）」->「篇章结构题」
function detectCategory(text) {
    const m = String(text || '').match(CATEGORY_RE);
    if (!m) return '';
    return m[1].split(/[（(：:，,、/|]/)[0].trim();
}

// 整段文本 -> 表单字段
export function parseQuestionText(raw) {
    const text = String(raw || '');
    const paper = detectPaper(text);
    const number = detectNumber(text);
    const { options, firstOptionLine } = parseOptions(text);

    const lines = text.split(/\r?\n/);
    const head = firstOptionLine < 0 ? lines : lines.slice(0, firstOptionLine);

    return {
        paper,
        number,
        stem: cleanStem(head, paper),
        options,
        answer: detectAnswer(text),
        myAnswer: detectMyAnswer(text),
        analysis: detectAnalysis(text),
        category: detectCategory(text)
    };
}
