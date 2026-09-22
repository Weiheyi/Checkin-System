import { PAGES, AUTO_CHECKIN_WORDS } from './config.js';
import { api } from './api.js';
import { $, $$, toast, confirmDialog, chooseDialog, reportDialog, setLoading, skeletonRows } from './ui.js';
import { initShell } from './shell.js';
import { extractFile, ACCEPT } from './file-extract.js';
import { phoneticOf, loadPhonetics, phoneticsReady, speak, warmUpVoices } from './phonetic.js';
import { dictReady, loadDictionary, meaningOf, meaningLines } from './dictionary.js';
import { createVocabTool } from './vocab.js';
import * as net from './net.js';

const els = {};
const BASE_TITLE = document.title;

function pad2(n) {
    return String(n).padStart(2, '0');
}

// 计时器显示到秒：HH:MM:SS
function formatHMS(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

// 倒计时显示到秒：MM:SS
function formatMS(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

// 计时进行中时把剩余/已用时间写进标签页标题，切到别的标签也能看到
function setTitleRunning(text) {
    document.title = text ? `${text} · ${BASE_TITLE}` : BASE_TITLE;
}

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// 倒计时结束的提示音；AudioContext 不可用时静默降级
function beep(times = 3) {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        let at = ctx.currentTime;
        for (let i = 0; i < times; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.28, at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
            osc.connect(gain).connect(ctx.destination);
            osc.start(at);
            osc.stop(at + 0.4);
            at += 0.5;
        }
        setTimeout(() => ctx.close().catch(() => {}), (times * 0.5 + 0.6) * 1000);
    } catch {
        /* 忽略：没有音频权限也不影响倒计时本身 */
    }
}

/* ---------------- 计时器 ---------------- */

const timer = { elapsed: 0, startedAt: 0, running: false, interval: null, laps: 0 };

function timerNow() {
    return timer.running ? timer.elapsed + (Date.now() - timer.startedAt) : timer.elapsed;
}

function renderTimer() {
    const text = formatHMS(timerNow());
    els.timerDisplay.textContent = text;
    if (timer.running) setTitleRunning(text);
}

function startTimer() {
    timer.startedAt = Date.now();
    timer.running = true;
    timer.interval = setInterval(renderTimer, 200);
    els.timerToggle.textContent = '暂停';
    els.timerHint.textContent = '计时中，切到别的页面也不会停';
    renderTimer();
}

function pauseTimer() {
    timer.elapsed = timerNow();
    timer.running = false;
    clearInterval(timer.interval);
    timer.interval = null;
    els.timerToggle.textContent = '继续';
    els.timerHint.textContent = '已暂停';
    setTitleRunning('');
    renderTimer();
}

function resetTimer() {
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.elapsed = 0;
    timer.laps = 0;
    els.timerToggle.textContent = '开始';
    els.timerHint.textContent = '点「开始」开始计时';
    els.lapList.replaceChildren();
    setTitleRunning('');
    renderTimer();
}

function addLap() {
    const total = timerNow();
    if (!timer.running && total === 0) return;

    timer.laps += 1;
    const prev = timer.laps > 1 ? total - Number(els.lapList.lastElementChild.dataset.total) : total;

    const li = document.createElement('li');
    li.className = 'lap-item';
    li.dataset.total = String(total);

    const index = document.createElement('span');
    index.textContent = `第 ${timer.laps} 次`;

    const lap = document.createElement('span');
    lap.className = 'lap-total';
    lap.textContent = formatHMS(total);

    const seg = document.createElement('span');
    seg.className = 'lap-seg';
    seg.textContent = `+${formatHMS(prev)}`;

    li.append(index, lap, seg);
    els.lapList.prepend(li);
}

/* ---------------- 倒计时 ---------------- */

const DEFAULT_MINUTES = 25;
const countdown = {
    total: DEFAULT_MINUTES * 60 * 1000,
    remaining: DEFAULT_MINUTES * 60 * 1000,
    endAt: 0,
    running: false,
    interval: null
};

function countdownLeft() {
    return countdown.running ? Math.max(0, countdown.endAt - Date.now()) : countdown.remaining;
}

function renderCountdown() {
    const left = countdownLeft();
    els.countdownDisplay.textContent = formatMS(left);
    els.countdownDisplay.classList.toggle('danger', left > 0 && left <= 60000);
    if (countdown.running) setTitleRunning(formatMS(left));
}

function stopCountdown() {
    clearInterval(countdown.interval);
    countdown.interval = null;
    countdown.running = false;
}

function setCountdownTotal(ms) {
    stopCountdown();
    countdown.total = ms;
    countdown.remaining = ms;
    els.countdownToggle.textContent = '开始';
    els.countdownDisplay.classList.remove('done');
    els.countdownHint.textContent = `已设定 ${Math.round(ms / 60000)} 分钟`;
    setTitleRunning('');
    renderCountdown();
}

function startCountdown() {
    if (countdown.remaining <= 0) countdown.remaining = countdown.total;
    countdown.endAt = Date.now() + countdown.remaining;
    countdown.running = true;
    countdown.interval = setInterval(tickCountdown, 200);
    els.countdownToggle.textContent = '暂停';
    els.countdownDisplay.classList.remove('done');
    els.countdownHint.textContent = '倒计时进行中，到点会响铃提醒';
    renderCountdown();
}

function tickCountdown() {
    countdown.remaining = Math.max(0, countdown.endAt - Date.now());
    renderCountdown();
    if (countdown.remaining <= 0) finishCountdown();
}

function pauseCountdown() {
    countdown.remaining = countdownLeft();
    stopCountdown();
    els.countdownToggle.textContent = '继续';
    els.countdownHint.textContent = '已暂停';
    setTitleRunning('');
    renderCountdown();
}

function finishCountdown() {
    stopCountdown();
    countdown.remaining = 0;
    els.countdownToggle.textContent = '开始';
    els.countdownDisplay.classList.add('done');
    els.countdownHint.textContent = '时间到！';
    setTitleRunning('');
    renderCountdown();
    beep(3);
    toast('倒计时结束，休息一下吧～', 'success');
}

function resetCountdown() {
    stopCountdown();
    countdown.remaining = countdown.total;
    els.countdownToggle.textContent = '开始';
    els.countdownDisplay.classList.remove('done');
    els.countdownHint.textContent = `已设定 ${Math.round(countdown.total / 60000)} 分钟`;
    setTitleRunning('');
    renderCountdown();
}

function applyCustomMinutes() {
    const minutes = Math.floor(Number(els.countdownMinutes.value));
    if (!minutes || minutes < 1 || minutes > 600) {
        return toast('请输入 1 ~ 600 之间的分钟数', 'error');
    }
    $$('#countdownPresets .preset-chip').forEach(chip => {
        chip.classList.toggle('active', Number(chip.dataset.minutes) === minutes);
    });
    els.countdownMinutes.value = '';
    setCountdownTotal(minutes * 60 * 1000);
}

/* ---------------- 单词表识别 ---------------- */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const POS_SET = new Set([
    'n', 'v', 'vt', 'vi', 'adj', 'adv', 'prep', 'pron', 'conj', 'num',
    'art', 'int', 'interj', 'aux', 'abbr', 'pl', 'det', 'pers'
]);

// 表头行（整行都是这些词时跳过，避免把「单词 释义」当成一个单词）
const HEADER_SET = new Set([
    '单词', '词汇', '英文', '英文单词', '中文', '释义', '词义', '翻译', '意思', '序号', '编号',
    'word', 'words', 'term', 'meaning', 'meanings', 'translation', 'definition', 'def',
    'no', 'index', 'english', 'chinese', 'vocabulary'
]);

// 整行就是标题时直接跳过（单独放宽 "list" 这类词会误删真正的单词）
const HEADER_PHRASES = new Set([
    '单词表', '词汇表', '生词表', '单词列表', '词汇列表', '英文单词', '中文释义',
    'vocabulary list', 'word list', 'words list', 'vocabulary', 'new words'
]);

function isHeaderLine(text) {
    const whole = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[：:、.]+$/, '');
    if (HEADER_PHRASES.has(whole)) return true;

    const tokens = text
        .split(/[\s,，:：|｜/\\\t]+/)
        .map(token => token.toLowerCase().replace(/[.、)）]+$/, ''))
        .filter(Boolean);

    return tokens.length > 0 && tokens.every(token => HEADER_SET.has(token));
}

function firstCjkIndex(text) {
    for (let i = 0; i < text.length; i++) {
        if (CJK_RE.test(text[i])) return i;
    }
    return -1;
}

// 把 term 末尾的词性标记（n. / vt. / adj. 等）挪到释义前面
function extractPos(term) {
    const parts = term.split(/\s+/).filter(Boolean);
    const pos = [];
    while (parts.length > 1) {
        const last = parts[parts.length - 1].toLowerCase().replace(/\.$/, '');
        if (!POS_SET.has(last)) break;
        pos.unshift(parts.pop());
    }
    if (!pos.length) return null;
    return { term: parts.join(' '), pos: pos.join(' ') };
}

// 一行 → { term, meaning }；识别不出中英配对时，整行当作单词
function parseLine(raw) {
    let text = String(raw).replace(/\u3000/g, ' ').trim();
    if (!text) return null;
    if (/^(#|\/\/)/.test(text)) return null;

    // 去掉行首序号：1. / 1、/ 1) / (1) / - / • 等
    text = text.replace(/^(?:\(\d{1,3}\)|\d{1,3}[.、)）:：]|[-*•·])\s*/, '').trim();
    if (!text) return null;
    if (isHeaderLine(text)) return null;

    let term = '';
    let meaning = '';

    // 1) 明确的分隔符，按可靠性从高到低尝试
    const delimiters = [
        /^(.+?)\t+(.+)$/,
        /^(.+?)\s*[|｜]\s*(.+)$/,
        /^(.+?)\s+[–—-]\s+(.+)$/,
        /^([^:：]+?)\s*[:：]\s*(.+)$/
    ];
    for (const re of delimiters) {
        const m = text.match(re);
        if (m) {
            term = m[1].trim();
            meaning = m[2].trim();
            break;
        }
    }

    // 2) 中英分界：英文在前、中文在后（或反之）
    if (!term) {
        const first = firstCjkIndex(text);
        if (first > 0) {
            term = text.slice(0, first).trim();
            meaning = text.slice(first).trim();
        } else if (first === 0) {
            const latin = text.search(/[A-Za-z]/);
            if (latin > 0) {
                meaning = text.slice(0, latin).trim();
                term = text.slice(latin).trim();
            }
        }
    }

    // 3) 逗号分隔
    if (!term) {
        const m = text.match(/^([^,，]{1,48})[,，]\s*(.+)$/);
        if (m) {
            term = m[1].trim();
            meaning = m[2].trim();
        }
    }

    if (!term) term = text;

    // 去掉 term 两端多余的分隔符，避免 "apple-" 这类残留
    term = term.replace(/^[\s\-–—:：,，|｜]+|[\s\-–—:：,，|｜]+$/g, '').trim();

    const pos = extractPos(term);
    if (pos) {
        term = pos.term;
        meaning = `${pos.pos} ${meaning}`.trim();
    }

    if (!term) return null;
    return { term, meaning };
}

// 多列表格拍平成一行后，一行里会挤进好几组「单词 + 释义」。
// 在「中文 + 空白 +（可选序号）+ 英文」处切分；刻意不用 lookbehind，
// 因为老浏览器不支持会让整个模块直接语法报错。
function splitPairs(line) {
    const marked = line.replace(
        /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])[ \t]+(?=(?:\d{1,3}[.、)）:：]?[ \t]*)?[A-Za-z])/g,
        '$1\n'
    );

    const parts = marked.split('\n').map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return [line];

    // 每一段都得同时含中英文，否则多半是切错了（例如中文在前的「苹果 apple」）
    const valid = parts.every(part => CJK_RE.test(part) && /[A-Za-z]/.test(part));
    return valid ? parts : [line];
}

// 整段文本 → 去重后的单词数组；swap 用于中英顺序颠倒的单词表
function parseWordList(text, { swap = false } = {}) {
    const seen = new Set();
    const list = [];

    function push(parsed) {
        if (!parsed) return;

        let { term, meaning } = parsed;
        if (swap) [term, meaning] = [meaning, term];

        const key = term.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        list.push({ term, meaning });
    }

    String(text || '').split(/\r?\n/).forEach(raw => {
        const line = raw.replace(/\u3000/g, ' ').trim();
        if (!line) return;

        const parts = splitPairs(line);
        if (parts.length > 1) parts.forEach(part => push(parseLine(part)));
        else push(parseLine(line));
    });

    return list;
}

/* ---------------- 缺释义的词用内置词典补齐 ---------------- */

// 导入的单词表里没写中文释义的词，从内置离线词典里补一条；
// 自己带了释义的（哪怕只有「n.」这种残缺内容）一律保持原样，绝不用词典覆盖上传的内容。
// 返回补上的条数。一个都不缺就直接返回 —— 不能为了保险去加载那 3MB 的词典。
async function fillMissingMeanings(list) {
    const missing = item => item && item.term && !String(item.meaning || '').trim();
    if (!list.some(missing)) return 0;

    // 词典加载失败就当没有释义：顶多补不了，不能因此把导入拦下来
    try {
        await loadDictionary();
    } catch {
        return 0;
    }

    let filled = 0;

    for (const item of list) {
        if (!missing(item)) continue;

        const senses = meaningLines(meaningOf(item.term));
        if (!senses.length) continue;

        // 多义项压成一行存，跟字典页「加入生词本」的写法保持一致
        item.meaning = senses.join('；');
        filled += 1;
    }

    return filled;
}

// 「识别到 N 个单词」；词典补过释义再补一句，让用户知道这些释义是哪儿来的
function setParsedCount(el, list, filled = 0) {
    el.textContent = filled
        ? `识别到 ${list.length} 个单词 · 已用词典补上 ${filled} 条释义`
        : `识别到 ${list.length} 个单词`;
}

/* ---------------- 单词排列与分页 ---------------- */

// 字母序：忽略大小写，数字按数值比（unit 9 排在 unit 10 前面）
const termCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function byTerm(a, b) {
    return termCollator.compare(a.term, b.term);
}

// 导入/追加时按「排列方式」重排；file 表示保持文件里的原始顺序
function arrangeParsed(list, mode) {
    return mode === 'alpha' ? list.slice().sort(byTerm) : list;
}

// 列表展示排序：file 按导入时的位置，alpha 按字母
function sortWords(list, mode) {
    const copy = list.slice();
    if (mode === 'alpha') copy.sort(byTerm);
    else copy.sort((a, b) => (a.position || 0) - (b.position || 0));
    return copy;
}

function syncSortSwitch(group, mode) {
    if (!group) return;
    [...group.querySelectorAll('button')].forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
    });
}

// 列表排序是个人偏好，记在本地，下次用同一台设备打开还是这个排序
const WORD_SORT_KEY = 'checkin_word_sort';

function loadListSort() {
    try {
        return localStorage.getItem(WORD_SORT_KEY) === 'alpha' ? 'alpha' : 'file';
    } catch {
        return 'file';
    }
}

function saveListSort(mode) {
    try {
        localStorage.setItem(WORD_SORT_KEY, mode);
    } catch {
        /* 隐私模式下写不了，忽略即可 */
    }
}

// 单词列表分页：一次只渲染一页，上千词的本子也不会卡
const PAGE_SIZES = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_KEY = 'checkin_word_page_size';

function loadPageSize() {
    try {
        const value = Number(localStorage.getItem(PAGE_SIZE_KEY));
        return PAGE_SIZES.includes(value) ? value : DEFAULT_PAGE_SIZE;
    } catch {
        return DEFAULT_PAGE_SIZE;
    }
}

function savePageSize(size) {
    try {
        localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
        /* 隐私模式下写不了，忽略即可 */
    }
}

// 考核限时：默认不限时（可选功能，不强制），选择记在本地
const QUIZ_LIMIT_KEY = 'checkin_quiz_limit';

function loadQuizLimit() {
    try {
        return Number(localStorage.getItem(QUIZ_LIMIT_KEY)) === 10 ? 10 : 0;
    } catch {
        return 0;
    }
}

function saveQuizLimit(seconds) {
    try {
        localStorage.setItem(QUIZ_LIMIT_KEY, String(seconds));
    } catch {
        /* 隐私模式下写不了，忽略即可 */
    }
}

/* ---------------- 单词本 ---------------- */

const wordsState = {
    books: [],
    current: null,
    words: [],
    parsed: [],
    addParsed: [],
    swap: false,
    importSort: 'file',
    addSort: 'file',
    listSort: loadListSort(),
    pageSize: loadPageSize(),
    page: 1,
    pages: 1,
    filter: 'all',
    selected: new Set()
};

// 搜单词：只在当前筛选 + 排序的结果里定位，报出的页码和列表显示的一致
const wordSearch = { query: '', matches: [], index: 0 };

// sessionPromise：本轮的学习记录会话 id，在第一次作答时才创建（没作答就不会留下空记录）
const study = { queue: [], index: 0, revealed: false, result: { known: 0, vague: 0, again: 0 }, sessionPromise: null };

const quiz = {
    type: 'choice',
    dir: 'term',
    // 'selected' 表示范围用「考核选中」挑出来的那批词
    scope: 'all',
    size: 10,
    customSize: 0,
    // 自定义题量是不是「考核选中」自动填的：是的话，取消选中时一并清掉
    customFromSelection: false,
    // 每题限时（秒），0 = 不限时；默认不限时
    limitSeconds: loadQuizLimit(),
    // 计时状态：开考时间 / 本题截止时间 / 刷新定时器
    startedAt: 0,
    questionEndsAt: 0,
    timerId: null,
    // 「考核选中」挑出来的词池，scope 为 selected 时使用
    override: null,
    questions: [],
    index: 0,
    correct: 0,
    wrong: [],
    answered: false,
    // 填义题自动判错时暂存本次作答，等用户确认「我答对了」或点下一题才落账
    pending: null,
    sessionPromise: null
};

// 最近一次背诵/考核的结果
const STATUS_LABELS = { known: '认识', vague: '模糊', again: '不认识', new: '未背' };
const FILTER_LABELS = { all: '全部', wrong: '错词', new: '未背', known: '认识', vague: '模糊', again: '不认识' };

// mastery 就是熟练度，答错一次清零，到 MASTERY_TARGET 即记为「已掌握」。
// 两条路进来：背诵点「认识」+1（自评，要连对 2 次）；考核（含消灭错词）答对一次
// 就 +MASTERY_TARGET，也就是答对即掌握 —— 考核是真正的检验，不该和自我感觉一个价。
// （原来两边都 +1，考核全对一轮只有 1，统计上永远是 0。）
// 改这个数要同步改 supabase/schema.sql 里 record_word_review 的 +2。
const MASTERY_TARGET = 2;

function wordStatus(word) {
    return word.last_result && STATUS_LABELS[word.last_result] ? word.last_result : 'new';
}

// 答错过（不管后来有没有消灭）
function hasWrong(word) {
    return word.wrong_count > 0;
}

// 待消灭的错词：答错过、且还没达到「已掌握」。
// 判定完全复用现有熟练度，不需要新增数据库字段。
function isWrongWord(word) {
    return hasWrong(word) && word.mastery < MASTERY_TARGET;
}

// 已消灭的错词：答错过，但已经掌握。列表里照样显示，只是标记出来
function isClearedWrong(word) {
    return hasWrong(word) && word.mastery >= MASTERY_TARGET;
}

function wordsByScope(scope) {
    const all = wordsState.words;
    if (scope === 'all') return all;
    // 「错词」= 所有答错过的词，包含已消灭的，免得消灭之后再也看不到
    if (scope === 'wrong') return all.filter(hasWrong);
    if (scope === 'new') return all.filter(word => !word.last_result);
    return all.filter(word => word.last_result === scope);
}

function showWordView(view) {
    els.wordHome.hidden = view !== 'home';
    els.wordImport.hidden = view !== 'import';
    els.wordDetail.hidden = view !== 'detail';
    els.wordRecords.hidden = view !== 'records';
}

const EMPTY_BOOKS_TEXT = '还没有单词本，点「新建」粘贴一份单词表就能开始了';

function renderBooks() {
    const books = wordsState.books;
    els.bookEmpty.textContent = EMPTY_BOOKS_TEXT;
    els.bookEmpty.hidden = books.length > 0;
    els.bookList.replaceChildren();

    const fragment = document.createDocumentFragment();
    books.forEach(book => {
        const row = document.createElement('div');
        row.className = 'book-item';

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'book-main';

        const name = document.createElement('span');
        name.className = 'book-name';
        name.textContent = book.name;

        const sub = document.createElement('span');
        sub.className = 'book-sub';
        sub.textContent = `${book.wordCount} 个单词`;

        main.append(name, sub);
        main.addEventListener('click', () => openBook(book.id));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-btn book-delete';
        del.textContent = '删除';
        del.setAttribute('aria-label', `删除单词本 ${book.name}`);
        del.addEventListener('click', () => removeBook(book));

        row.append(main, del);
        fragment.appendChild(row);
    });

    els.bookList.appendChild(fragment);
}

function computeStats(words) {
    const total = words.length;
    const mastered = words.filter(w => w.mastery >= MASTERY_TARGET).length;
    const correct = words.reduce((sum, w) => sum + w.correct_count, 0);
    const wrong = words.reduce((sum, w) => sum + w.wrong_count, 0);
    const rate = correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
    return { total, mastered, rate };
}

function renderDetailStats() {
    const stats = computeStats(wordsState.words);
    els.detailStats.replaceChildren(
        statItem('📚', stats.total, '单词总数'),
        statItem('✅', stats.mastered, '已掌握', `考核（含灭错）答对一次即掌握；背诵点「认识」要连对 ${MASTERY_TARGET} 次`),
        statItem('🎯', `${stats.rate}%`, '正确率')
    );
    updateWrongTabLabel();
}

function statItem(icon, value, label, hint = '') {
    const wrap = document.createElement('div');
    wrap.className = 'stat-item';
    if (hint) wrap.title = hint;

    const iconEl = document.createElement('div');
    iconEl.className = 'stat-icon';
    iconEl.textContent = icon;

    const valueEl = document.createElement('div');
    valueEl.className = 'stat-number';
    valueEl.textContent = value;

    const labelEl = document.createElement('div');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    wrap.append(iconEl, valueEl, labelEl);
    return wrap;
}

function renderPreview(host, list) {
    host.replaceChildren();

    const fragment = document.createDocumentFragment();
    list.slice(0, 200).forEach(item => {
        const row = document.createElement('div');
        row.className = 'word-preview-item';

        const term = document.createElement('span');
        term.className = 'preview-term';
        term.textContent = item.term;

        const meaning = document.createElement('span');
        meaning.className = 'preview-meaning' + (item.meaning ? '' : ' empty');
        meaning.textContent = item.meaning || '（无释义）';

        row.append(term, meaning);
        fragment.appendChild(row);
    });

    if (list.length > 200) {
        const more = document.createElement('div');
        more.className = 'word-preview-more';
        more.textContent = `……还有 ${list.length - 200} 个`;
        fragment.appendChild(more);
    }

    host.appendChild(fragment);
}

/* ---------------- 新建 / 导入 ---------------- */

function openImport() {
    wordsState.parsed = [];
    wordsState.swap = false;
    wordsState.importSort = 'file';
    els.bookName.value = '';
    els.bookText.value = '';
    els.importCount.textContent = '识别到 0 个单词';
    els.importSave.disabled = true;
    els.swapToggle.classList.remove('active');
    syncSortSwitch(els.importSortGroup, wordsState.importSort);
    els.wordPreview.hidden = true;
    els.wordPreview.replaceChildren();
    els.previewToggle.textContent = '预览';
    showWordView('import');
    els.bookName.focus();
}

async function refreshImport() {
    const list = arrangeParsed(
        parseWordList(els.bookText.value, { swap: wordsState.swap }),
        wordsState.importSort
    );
    wordsState.parsed = list;
    setParsedCount(els.importCount, list);
    els.importSave.disabled = list.length === 0;
    if (!els.wordPreview.hidden) renderPreview(els.wordPreview, list);

    // 解析结果先上屏；词典是异步的，补完再刷一次数量和预览
    const filled = await fillMissingMeanings(list);
    // 等词典这会儿用户又改了内容，就以新的那次为准
    if (!filled || wordsState.parsed !== list) return;

    setParsedCount(els.importCount, list, filled);
    if (!els.wordPreview.hidden) renderPreview(els.wordPreview, list);
}

async function saveImport() {
    const words = wordsState.parsed;
    if (!words.length) return toast('还没有识别到单词', 'error');

    const name = els.bookName.value.trim() || '未命名单词本';
    setLoading(els.importSave, true);
    try {
        // 用户可能在词典还没加载完时就点了保存，这里再兜一次底（全都带释义时不碰词典）
        await fillMissingMeanings(words);

        const { book } = await api.wordbooks.create({ name, words });
        wordsState.books.unshift(book);
        renderBooks();
        showWordView('home');
        toast(`已保存「${name}」，共 ${book.wordCount} 个单词`, 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.importSave, false);
    }
}

async function removeBook(book) {
    const ok = await confirmDialog({
        title: '删除单词本',
        message: `确定删除「${book.name}」吗？本子里的单词和背诵进度会一起删除。`,
        confirmText: '删除',
        danger: true
    });
    if (!ok) return;

    try {
        await api.wordbooks.remove(book.id);
        wordsState.books = wordsState.books.filter(item => item.id !== book.id);
        renderBooks();
        toast('已删除', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ---------------- 单词本详情 ---------------- */

async function openBook(id) {
    try {
        const { book, words } = await api.wordbooks.detail(id);
        wordsState.current = book;
        wordsState.words = words;
        wordsState.filter = 'all';
        wordsState.page = 1;
        wordsState.selected.clear();
        resetSearch();
        // 「考核选中」的词池属于上一本书，换本子就作废
        quiz.override = null;
        if (quiz.scope === 'selected') quiz.scope = 'all';
        els.detailTitle.textContent = book.name;
        syncSortSwitch(els.wordSortGroup, wordsState.listSort);
        renderDetailStats();
        showWordView('detail');
        openDetailTab(words.length ? 'study' : 'list');
    } catch (err) {
        toast(err.message, 'error');
    }
}

function openDetailTab(view) {
    els.detailTabs.hidden = view === 'add';
    els.studyView.hidden = view !== 'study';
    els.quizView.hidden = view !== 'quiz';
    els.listView.hidden = view !== 'list';
    els.wrongView.hidden = view !== 'wrong';
    els.addWordsView.hidden = view !== 'add';
    $$('#detailTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

    // 离开考核页就停表，别在后台空转
    if (view !== 'quiz') stopQuizTimer();

    if (view === 'study') startStudy();
    else if (view === 'quiz') resetQuizSetup();
    else if (view === 'list') renderWordList();
    else if (view === 'wrong') renderWrongTab();
}

function renderWordFilter() {
    const counts = { all: wordsState.words.length, wrong: 0, new: 0, known: 0, vague: 0, again: 0 };
    wordsState.words.forEach(word => {
        counts[wordStatus(word)] += 1;
        if (hasWrong(word)) counts.wrong += 1;
    });

    $$('#wordFilter button').forEach(btn => {
        const key = btn.dataset.filter;
        btn.classList.toggle('active', key === wordsState.filter);
        btn.textContent = `${FILTER_LABELS[key]} ${counts[key]}`;
    });
}

function renderSelectBar() {
    const size = wordsState.selected.size;
    els.selectCount.textContent = `已选 ${size} 个`;
    els.quizSelectedBtn.disabled = size === 0;
}

// 当前筛选 + 排序下的完整单词列表（分页之前的）
function visibleWords() {
    return sortWords(wordsByScope(wordsState.filter), wordsState.listSort);
}

function renderWordList() {
    ensurePhonetics();
    renderWordFilter();
    renderSelectBar();

    const visible = visibleWords();
    const { start, end, pages } = pageRange(visible.length);
    const shown = visible.slice(start, end);

    els.wordEmpty.hidden = visible.length > 0;
    els.wordEmpty.textContent = wordsState.words.length ? '这个筛选条件下还没有单词' : '这个本子还没有单词';

    const fragment = document.createDocumentFragment();

    // 搜索命中的词在列表里标出来，当前定位的那一个再深一点
    const found = new Set(wordSearch.matches.map(hit => hit.word.id));
    const focus = wordSearch.matches[wordSearch.index];

    shown.forEach(word => {
        const li = document.createElement('li');
        li.className = 'word-item';
        li.dataset.wordId = word.id;
        if (found.has(word.id)) {
            li.classList.add('is-found');
            if (focus && focus.word.id === word.id) li.classList.add('is-focus');
        }

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'word-check';
        check.checked = wordsState.selected.has(word.id);
        check.setAttribute('aria-label', `选择单词 ${word.term}`);
        check.addEventListener('change', () => {
            if (check.checked) wordsState.selected.add(word.id);
            else wordsState.selected.delete(word.id);
            renderSelectBar();
        });

        const main = document.createElement('div');
        main.className = 'word-main';

        const term = document.createElement('div');
        term.className = 'word-term';
        term.textContent = word.term;

        main.appendChild(term);

        const ipa = phoneticOf(word.term);
        if (ipa) {
            const phonetic = document.createElement('div');
            phonetic.className = 'word-phonetic';
            phonetic.textContent = ipa;
            main.appendChild(phonetic);
        }

        const meaning = document.createElement('div');
        meaning.className = 'word-meaning';
        meaning.textContent = word.meaning || '—';
        main.appendChild(meaning);

        const status = wordStatus(word);
        const badge = document.createElement('span');
        badge.className = `status-badge status-${status}`;
        badge.textContent = STATUS_LABELS[status];

        const report = document.createElement('button');
        report.type = 'button';
        report.className = 'report-btn';
        report.textContent = '修正';
        report.setAttribute('aria-label', `修正单词 ${word.term} 的拼写或释义`);
        report.addEventListener('click', () => fixWord({
            word,
            term: word.term,
            meaning: word.meaning,
            source: 'list',
            refresh: renderWordList
        }));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-btn word-delete';
        del.textContent = '删除';
        del.setAttribute('aria-label', `删除单词 ${word.term}`);
        del.addEventListener('click', () => removeWord(word));

        li.append(check, main, badge);
        // 答错过的词被消灭后依然留在「错词」里，标一下状态，免得看不到
        if (isClearedWrong(word)) {
            const cleared = document.createElement('span');
            cleared.className = 'status-badge status-cleared';
            cleared.textContent = '已消灭';
            li.appendChild(cleared);
        }
        li.append(report, del);
        fragment.appendChild(li);
    });

    els.wordList.replaceChildren(fragment);
    renderWordPager(visible.length, pages);
    renderSearchHint();
}

// 当前页要渲染的区间；顺带把页码夹回合法范围（筛选、排序、删词之后总数都会变）
function pageRange(total) {
    const pages = Math.max(1, Math.ceil(total / wordsState.pageSize));
    wordsState.page = Math.min(Math.max(wordsState.page, 1), pages);

    const start = (wordsState.page - 1) * wordsState.pageSize;
    return { pages, start, end: start + wordsState.pageSize };
}

function renderWordPager(total, pages) {
    wordsState.pages = pages;
    els.wordPager.hidden = total === 0;
    els.pageInfo.textContent = `第 ${wordsState.page} / ${pages} 页 · 共 ${total} 个`;
    els.pagePrev.disabled = wordsState.page <= 1;
    els.pageNext.disabled = wordsState.page >= pages;

    [...els.pageSizeGroup.querySelectorAll('button')].forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.size) === wordsState.pageSize);
    });

    // 跳页输入框跟着当前页走；正在里面打字时不要覆盖用户输入
    els.pageJump.max = String(pages);
    if (document.activeElement !== els.pageJump) els.pageJump.value = String(wordsState.page);
}

// 输入页码后自动跳转：超出范围就夹到合法页码，非法输入忽略
function jumpToTypedPage() {
    const typed = Math.floor(Number(els.pageJump.value));
    if (!Number.isFinite(typed) || typed < 1) return;

    const target = Math.min(typed, Math.max(1, wordsState.pages));
    if (String(target) !== els.pageJump.value) els.pageJump.value = String(target);
    if (target !== wordsState.page) goToPage(target);
}

function goToPage(page) {
    wordsState.page = page;
    renderWordList();
    // 已经翻到列表下方时回到列表开头，省得手动往上滚
    if (els.wordList.getBoundingClientRect().top < 0) {
        els.wordList.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
}

/* ---------------- 搜单词：告诉用户这个词在第几页 ---------------- */

// 命中的词按「完全相同 → 开头 → 包含 → 释义包含」排，最想要的排最前面；
// index 是它在整个筛选结果里的下标，用它算页码
function searchWords(query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const exact = [];
    const prefix = [];
    const partial = [];
    const byMeaning = [];

    visibleWords().forEach((word, index) => {
        const term = (word.term || '').toLowerCase();
        const hit = { word, index };
        if (term === needle) exact.push(hit);
        else if (term.startsWith(needle)) prefix.push(hit);
        else if (term.includes(needle)) partial.push(hit);
        else if ((word.meaning || '').toLowerCase().includes(needle)) byMeaning.push(hit);
    });

    return [...exact, ...prefix, ...partial, ...byMeaning];
}

function searchPageOf(hit) {
    return Math.floor(hit.index / wordsState.pageSize) + 1;
}

// 筛选 / 排序 / 每页条数变了：重新算命中，尽量还停在原来那个词上
function refreshSearch() {
    const current = wordSearch.matches[wordSearch.index];
    wordSearch.matches = searchWords(wordSearch.query);
    const stay = current ? wordSearch.matches.findIndex(hit => hit.word.id === current.word.id) : -1;
    wordSearch.index = stay >= 0 ? stay : 0;
}

// 跳到命中的那一页并高亮；没有命中就只重画（顺便清掉高亮）
function focusMatch() {
    const hit = wordSearch.matches[wordSearch.index];
    if (hit) wordsState.page = searchPageOf(hit);
    renderWordList();
    if (hit) scrollToWord(hit.word.id);
}

function scrollToWord(id) {
    const row = els.wordList.querySelector(`[data-word-id="${id}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// 输入框内容变了：从头开始找
function runSearch() {
    wordSearch.query = els.wordSearch.value;
    wordSearch.index = 0;
    refreshSearch();
    focusMatch();
}

// 回车 /「下一个」：在命中结果里循环
function stepSearch(step) {
    const total = wordSearch.matches.length;
    if (!total) return;
    wordSearch.index = (wordSearch.index + step + total) % total;
    focusMatch();
}

function renderSearchHint() {
    const query = wordSearch.query.trim();
    els.wordSearchNext.hidden = wordSearch.matches.length < 2;
    els.wordSearchHint.replaceChildren();

    if (!query) {
        els.wordSearchHint.hidden = true;
        return;
    }

    els.wordSearchHint.hidden = false;

    if (!wordSearch.matches.length) {
        // 找不到多半是筛选把词挡住了，提醒一下
        const scope = wordsState.filter === 'all' ? '' : `（当前筛选：${FILTER_LABELS[wordsState.filter]}）`;
        els.wordSearchHint.textContent = `没有找到「${query}」${scope}，换个词或切到「全部」试试`;
        return;
    }

    const hit = wordSearch.matches[wordSearch.index];
    const total = wordSearch.matches.length;

    const where = document.createElement('span');
    where.className = 'word-search-hit';
    where.textContent = `「${hit.word.term}」在第 ${searchPageOf(hit)} 页`;

    let tail = '';
    if (total > 1) tail = ` · 匹配 ${total} 个，当前第 ${wordSearch.index + 1} 个（回车看下一个）`;
    else if (wordsState.filter !== 'all') tail = ` · 当前筛选：${FILTER_LABELS[wordsState.filter]}`;

    els.wordSearchHint.append(where, document.createTextNode(tail));
}

// 换本子：搜索框和结果一起清掉
function resetSearch() {
    wordSearch.query = '';
    wordSearch.matches = [];
    wordSearch.index = 0;
    if (els.wordSearch) els.wordSearch.value = '';
    renderSearchHint();
}

// 筛选 / 排序 / 每页条数变了：带着搜索结果一起重画
function refreshWordList() {
    refreshSearch();
    if (wordSearch.query.trim()) focusMatch();
    else renderWordList();
}

// 只选中当前这一页显示的单词，不是整个筛选结果
function selectCurrentPage() {
    const visible = visibleWords();
    const { start, end } = pageRange(visible.length);
    visible.slice(start, end).forEach(word => wordsState.selected.add(word.id));
    renderWordList();
}

function clearSelection() {
    wordsState.selected.clear();
    renderWordList();
}

async function removeWord(word) {
    try {
        await api.wordbooks.removeWord(word.id);
        wordsState.words = wordsState.words.filter(item => item.id !== word.id);
        wordsState.selected.delete(word.id);
        wordsState.current.wordCount = wordsState.words.length;
        refreshWordList();
        renderDetailStats();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function resetProgress() {
    const ok = await confirmDialog({
        title: '重置进度',
        message: '确定把这本书所有单词的背诵进度清零吗？',
        confirmText: '重置',
        danger: true
    });
    if (!ok) return;

    try {
        await api.wordbooks.resetProgress(wordsState.current.id);
        wordsState.words.forEach(word => {
            word.mastery = 0;
            word.review_count = 0;
            word.correct_count = 0;
            word.wrong_count = 0;
            word.last_result = '';
            word.last_reviewed_at = null;
        });
        renderWordList();
        renderDetailStats();
        toast('进度已重置', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ---------------- 追加单词 ---------------- */

function openAddWords() {
    wordsState.addParsed = [];
    wordsState.addSort = 'file';
    els.addText.value = '';
    els.addCount.textContent = '识别到 0 个单词';
    els.addSave.disabled = true;
    syncSortSwitch(els.addSortGroup, wordsState.addSort);
    els.addPreview.hidden = true;
    els.addPreview.replaceChildren();
    els.addPreviewToggle.textContent = '预览';
    openDetailTab('add');
    els.addText.focus();
}

async function refreshAdd() {
    const list = arrangeParsed(
        parseWordList(els.addText.value, { swap: false }),
        wordsState.addSort
    );
    wordsState.addParsed = list;
    setParsedCount(els.addCount, list);
    els.addSave.disabled = list.length === 0;
    if (!els.addPreview.hidden) renderPreview(els.addPreview, list);

    // 与新建单词本同一套规则：缺释义的从内置词典补，写了的原样保留
    const filled = await fillMissingMeanings(list);
    if (!filled || wordsState.addParsed !== list) return;

    setParsedCount(els.addCount, list, filled);
    if (!els.addPreview.hidden) renderPreview(els.addPreview, list);
}

async function saveAddWords() {
    const words = wordsState.addParsed;
    if (!words.length) return toast('还没有识别到单词', 'error');

    setLoading(els.addSave, true);
    try {
        // 同上：词典是异步加载的，保存前再确认一次缺的释义都补齐了
        await fillMissingMeanings(words);

        const { words: inserted } = await api.wordbooks.addWords(wordsState.current.id, words);
        wordsState.words.push(...inserted);
        wordsState.current.wordCount = wordsState.words.length;
        renderDetailStats();
        openDetailTab('list');
        toast(`已追加 ${inserted.length} 个单词`, 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.addSave, false);
    }
}

/* ---------------- 音标与发音 ---------------- */

let phoneticsRequested = false;

// 音标词典约 2.9MB，打开单词本后再后台加载；没加载完就先不显示音标
function ensurePhonetics() {
    if (phoneticsReady() || phoneticsRequested) return;
    phoneticsRequested = true;

    loadPhonetics()
        .then(() => {
            paintStudyPhonetic();
            if (!els.listView.hidden) renderWordList();
        })
        .catch(() => {
            // 词典加载失败就静默降级：没有音标，但发音和背诵都照常
        });
}

function paintStudyPhonetic() {
    const word = currentStudyWord();
    const ipa = word ? phoneticOf(word.term) : '';
    els.studyPhonetic.textContent = ipa;
    els.studyPhonetic.hidden = !ipa;
}

function makeSpeakButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'speak-btn';
    btn.textContent = '🔊';
    btn.title = '朗读（美音）';
    btn.setAttribute('aria-label', '朗读（美音）');
    btn.addEventListener('click', event => {
        event.stopPropagation();
        if (!speak(text)) toast('当前浏览器不支持语音朗读', 'error');
    });
    return btn;
}

/* ---------------- 词条报错 / 修正 ---------------- */

// 当前打开的单词本；字典查词不属于任何本子，调用方显式传 bookId: null
function currentBookId() {
    return wordsState.current ? wordsState.current.id : null;
}

// 词条有问题时让用户自己改：保存后写回 words（服务端同时同步该词历史背诵明细），
// 立即生效；字典里的词不属于 words 表，只能像以前那样报错。
// refresh 由各入口传入，改完只刷新当前那一处视图
async function fixWord({ word, term, meaning, source, bookId = currentBookId(), refresh }) {
    const editable = !!(word && word.id);
    const result = await reportDialog({ term, meaning, editable });
    if (!result) return;

    // 字典：静态只读数据，改不了，照旧只提交报错
    if (!editable) {
        try {
            await api.wordReports.create({
                wordId: null,
                bookId: null,
                term,
                meaning,
                reason: result.reason,
                note: result.note,
                source
            });
            toast('已报错，谢谢你帮忙核对', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
        return;
    }

    const nextTerm = result.term;
    const nextMeaning = result.meaning;
    const changed = nextTerm !== term || nextMeaning !== meaning;

    if (changed) {
        try {
            await api.wordbooks.updateWord(word.id, { term: nextTerm, meaning: nextMeaning });
        } catch (err) {
            return toast(err.message, 'error');
        }

        // 列表 / 背诵 / 考核 / 灭错共用同一个词条对象，原地改字段就能全站生效
        word.term = nextTerm;
        word.meaning = nextMeaning;
    }

    // 改了内容或选了原因才留记录；两者都没有就是纯粹没动，不必写
    if (changed || result.reason) {
        try {
            await api.wordReports.create({
                wordId: word.id,
                bookId,
                term: nextTerm,
                meaning: nextMeaning,
                reason: result.reason || '用户自行修正',
                note: result.note,
                source
            });
        } catch {
            /* 忽略：只是留给站长核对的轨迹，记录失败不影响已生效的修改 */
        }
    }

    if (changed) {
        toast('已更新词条', 'success');
        if (refresh) refresh();
    } else {
        toast('没有改动', 'info');
    }
}

// 答题反馈区里的小号修正入口
function makeFixLink(entry, refresh) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'report-link';
    btn.textContent = '✏️ 这个释义不对？点这里改';
    btn.addEventListener('click', () => fixWord({ ...entry, refresh }));
    return btn;
}

/* ---------------- 背诵 ---------------- */

function startStudy() {
    const words = wordsState.words;
    if (!words.length) {
        els.studyProgress.textContent = '';
        els.studyCard.hidden = true;
        els.studyActions.hidden = true;
        els.studyReportRow.hidden = true;
        els.studySummary.hidden = false;
        renderSummary(els.studySummary, [], '这个本子还没有单词');
        return;
    }

    ensurePhonetics();

    study.queue = words.slice();
    if (els.studyShuffle.checked) shuffle(study.queue);
    study.index = 0;
    study.revealed = false;
    study.sessionPromise = null;
    study.warned = false;
    study.result = { known: 0, vague: 0, again: 0 };

    els.studySummary.hidden = true;
    els.studyCard.hidden = false;
    renderStudy();
}

function currentStudyWord() {
    return study.queue[study.index];
}

function renderStudy() {
    const word = currentStudyWord();
    if (!word) return finishStudy();

    study.revealed = false;
    els.studyTerm.textContent = word.term;
    els.studyMeaning.textContent = word.meaning || '（没有释义）';
    els.studyMeaning.hidden = true;
    els.studyTip.hidden = false;
    els.studyActions.hidden = true;
    els.studyReportRow.hidden = true;
    els.studyProgress.textContent = `${study.index + 1} / ${study.queue.length}`;
    els.studyCard.classList.remove('revealed');

    paintStudyPhonetic();

    if (els.studyAutoSpeak.checked) speak(word.term);
}

function revealStudy() {
    if (study.revealed || els.studyCard.hidden) return;
    study.revealed = true;
    els.studyMeaning.hidden = false;
    els.studyTip.hidden = true;
    els.studyActions.hidden = false;
    els.studyReportRow.hidden = false;
    els.studyCard.classList.add('revealed');
}

// 改完词条只换卡片上的单词/释义与音标。不能走 renderStudy()：
// 那会把「已翻开」重置掉，用户刚改完就得重新点开一次
function refreshStudyCard() {
    const word = currentStudyWord();
    if (!word) return;

    els.studyTerm.textContent = word.term;
    els.studyMeaning.textContent = word.meaning || '（没有释义）';
    paintStudyPhonetic();
}

function markStudy(mark) {
    const word = currentStudyWord();
    if (!word || !study.revealed) return;

    if (mark === 'known') {
        word.mastery = Math.min(5, word.mastery + 1);
        word.correct_count += 1;
    } else if (mark === 'again') {
        word.mastery = 0;
        word.wrong_count += 1;
    }
    word.review_count += 1;
    word.last_result = mark;
    logReview('study', study, word, mark, study.queue.length);

    study.result[mark] += 1;
    study.index += 1;
    if (study.index >= study.queue.length) finishStudy();
    else renderStudy();
}

function finishStudy() {
    const result = study.result;
    const total = study.queue.length;
    els.studyCard.hidden = true;
    els.studyActions.hidden = true;
    els.studyReportRow.hidden = true;
    els.studyProgress.textContent = total ? `${total} / ${total}` : '';
    els.studySummary.hidden = false;
    renderSummary(els.studySummary, [
        ['认识', result.known],
        ['模糊', result.vague],
        ['不认识', result.again]
    ], `本轮完成，共 ${total} 个单词`);

    const answered = result.known + result.vague + result.again;
    if (answered) recordStudyTask(`📖 背单词：${studyBookName()}（${answered} 个）`);

    renderDetailStats();
}

/* ---------------- 填义自动判分 ---------------- */

// 释义里的词性标记、括号注解、标点先清掉，只留下可比较的汉字 / 字母
const BRACKET_RE = /\[[^\]]*\]|\([^)]*\)|（[^）]*）|【[^】]*】/g;
const POS_HEAD_RE = /^(?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|interj|aux|abbr|pl|det)\.?\s+/i;
const SENSE_SEP_RE = /[；;，,、|｜/]+/;

function normalizeSense(text) {
    const s = String(text)
        // 释义里的换行是字面 \n（反斜杠 + n），先换成空格，别让它退化成字母 n
        .replace(/\\r\\n|\\n|\\r/g, ' ')
        .replace(BRACKET_RE, ' ')
        .replace(POS_HEAD_RE, '')
        .replace(/[\s\u3000]+/g, '')
        .replace(/[.。·:：;；,，、!！?？"'“”‘’`~()（）\[\]【】{}<>《》/\\|｜\-–—_+@#$%^&*=]/g, '')
        .toLowerCase();
    // 「无所不在的」≈「无所不在」：只削一个字的词尾，且削完至少还剩两个字
    return s.length >= 3 && /[的地得]$/.test(s) ? s.slice(0, -1) : s;
}

// 一个释义常有好几个义项（「放弃；抛弃」），拆开逐个比对；
// 字面 \n 的分行也当成义项分隔
function meaningSenses(meaning) {
    return String(meaning || '')
        .replace(/\\r\\n|\\n|\\r/g, '；')
        .split(SENSE_SEP_RE)
        .map(normalizeSense)
        .filter(Boolean);
}

// 参考答案 = 单词本里写的释义 + 本地词典里同一个词的释义。
// 用户导入的释义常常只是词典里的一条，把词典里的其它义项也算对，能明显减少误判。
function answerSenses(meaning, term) {
    const list = meaningSenses(meaning);
    if (term && dictReady()) list.push(...meaningSenses(meaningOf(term)));
    return [...new Set(list)];
}

// 填义判分要把本地词典当参考答案用，开考前先在后台热一下（只需加载一次）
function warmUpDictionary() {
    if (!dictReady()) loadDictionary().catch(() => {});
}

// 最长公共子序列长度，用来容忍个别字的出入
function commonLength(a, b) {
    const n = b.length;
    let prev = new Array(n + 1).fill(0);
    let cur = new Array(n + 1).fill(0);

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= n; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        [prev, cur] = [cur, prev];
        cur.fill(0);
    }
    return prev[n];
}

// 填义判分：命中任一参考答案即算对。判定由严到宽：
// 完全一致 → 互相包含 → 高度相似（公共子序列 ≥ 80%）→ 长释义只差一字 / 同字异序。
// 中文写法多样，这只是近似判断：判错时另有「我答对了」入口可手动纠正。
function judgeMeaning(input, meaning, term) {
    const user = normalizeSense(input);
    if (!user) return false;

    return answerSenses(meaning, term).some(sense => {
        if (sense === user) return true;

        // 单字太容易误判（「是」「的」），只认完全一致
        const shorter = Math.min(user.length, sense.length);
        if (shorter < 2) return false;

        // 互相包含：「苹果」对「苹果树」，「苹果公司」对「苹果」
        if (sense.includes(user) || user.includes(sense)) return true;

        const common = commonLength(user, sense);
        if (common / shorter >= 0.8) return true;

        // 长一点的释义，只差一个字也算「意思差不多」
        if (shorter >= 3 && common >= shorter - 1) return true;

        // 同字异序（如 变化无常 / 无常变化）：用字基本重合、字数也接近
        const a = new Set(user);
        const b = new Set(sense);
        const shared = [...a].filter(c => b.has(c)).length;
        return shared / Math.max(a.size, b.size) >= 0.8 && Math.abs(user.length - sense.length) <= 1;
    });
}

/* ---------------- 考核 ---------------- */

function resetQuizSetup() {
    stopQuizTimer();
    els.quizSetup.hidden = false;
    els.quizRun.hidden = true;
    els.quizResult.hidden = true;
    syncQuizScope();
    syncQuizSize();
    syncQuizLimit();
    updateQuizHint();
}

// 范围按钮的选中态；「选中」只在真正挑了词时才出现，文案带上数量
function syncQuizScope() {
    const count = quiz.override ? quiz.override.length : 0;
    els.quizScopeSelected.hidden = count === 0;
    els.quizScopeSelected.textContent = count ? `选中 ${count}` : '选中';
    $$('#quizScopeGroup button').forEach(btn => btn.classList.toggle('active', btn.dataset.scope === quiz.scope));
}

// 题量按钮的选中态：填了自定义题量时，上方的预设都不高亮
function syncQuizSize() {
    $$('#quizSizeGroup button').forEach(btn => {
        btn.classList.toggle('active', quiz.customSize === 0 && Number(btn.dataset.size) === quiz.size);
    });
}

function syncQuizLimit() {
    $$('#quizLimitGroup button').forEach(btn => {
        btn.classList.toggle('active', (Number(btn.dataset.limit) || 0) === quiz.limitSeconds);
    });
}

/* ---- 考核计时 / 限时 ---- */

function quizElapsedMs() {
    return quiz.startedAt ? Date.now() - quiz.startedAt : 0;
}

function startQuizTimer() {
    stopQuizTimer();
    quiz.startedAt = Date.now();
    quiz.timerId = setInterval(tickQuizTimer, 200);
    tickQuizTimer();
}

function stopQuizTimer() {
    clearInterval(quiz.timerId);
    quiz.timerId = null;
}

function tickQuizTimer() {
    els.quizElapsed.textContent = `⏱ ${formatHMS(quizElapsedMs())}`;

    // 不限时的话只需要总用时
    if (!quiz.limitSeconds) return;

    const left = quiz.questionEndsAt - Date.now();
    const seconds = Math.max(0, Math.ceil(left / 1000));
    els.quizCountdown.textContent = `剩 ${seconds} 秒`;
    els.quizCountdown.classList.toggle('danger', seconds <= 3);

    if (left <= 0 && !quiz.answered) timeUpQuizQuestion();
}

// 单题超时：直接按答错落账（时间到了就不给「我答对了」的机会了）
function timeUpQuizQuestion() {
    const question = quiz.questions[quiz.index];
    if (!question || quiz.answered) return;

    quiz.answered = true;
    quiz.pending = null;
    els.quizOverride.hidden = true;

    if (question.kind === 'choice') {
        $$('.quiz-option', els.quizOptions).forEach(el => {
            el.disabled = true;
            if (el.textContent === question.answer) el.classList.add('correct');
        });
    } else {
        els.quizInput.disabled = true;
        els.quizSubmit.disabled = true;
    }

    commitQuizAnswer(question, false, '（超时）');
    renderAnswerFeedback(question, false, true);
}

// 当前范围里可参与考核的单词；scope 为 selected 时用「考核选中」挑出来的词池
function quizPool() {
    if (quiz.scope === 'selected') return (quiz.override || []).filter(word => word.term && word.meaning);
    return wordsByScope(quiz.scope).filter(word => word.term && word.meaning);
}

function quizLimit(poolSize) {
    const wanted = quiz.customSize > 0 ? quiz.customSize : quiz.size;
    return wanted > 0 ? Math.min(wanted, poolSize) : poolSize;
}

function updateQuizHint() {
    const pool = quizPool();
    const picked = quizLimit(pool.length);
    const notes = [];

    if (quiz.scope === 'selected') {
        notes.push(`范围是「考核选中」挑出的 ${(quiz.override || []).length} 个单词，本次考核 ${picked} 题。`);
        notes.push('改动上面的「范围」会取消这次选中。');
    } else {
        notes.push(`本子共 ${wordsState.words.length} 个单词，「${FILTER_LABELS[quiz.scope]}」范围内 ${pool.length} 个可考核，随机抽 ${picked} 题。`);
    }

    if (!pool.length) {
        notes.push('该范围内没有可考核的单词，请先补释义或换个范围。');
    } else if (quiz.type === 'choice' && pool.length < 4) {
        notes.push('选择题至少需要 4 个带释义的单词才能凑齐选项，建议改用拼写。');
    } else if (quiz.type === 'meaning') {
        notes.push('填义题按中文意思自动判分，判错时可点「我答对了，算对」纠正。');
    }

    if (quiz.limitSeconds) notes.push(`每题限时 ${quiz.limitSeconds} 秒，超时按答错计。`);

    els.quizSetupHint.textContent = notes.join(' ');
}

// 由词条现场生成一道题；改完词条后也能拿它重建当前题目（answer / options 是构建时的
// 字符串拷贝，光改 word 对象不会跟着变）
function makeQuizQuestion(word) {
    if (quiz.type === 'spell') {
        return { word, kind: 'spell', prompt: word.meaning, sub: '根据释义拼写单词', answer: word.term };
    }
    if (quiz.type === 'meaning') {
        return { word, kind: 'meaning', prompt: word.term, sub: '写出这个单词的中文意思', answer: word.meaning };
    }

    const byTerm = quiz.dir === 'term';
    const answer = byTerm ? word.meaning : word.term;
    const field = byTerm ? 'meaning' : 'term';
    // 干扰项从整本书里取，选项才不至于过于集中
    const usable = wordsState.words.filter(w => w.term && w.meaning);
    const distractors = shuffle(usable.filter(w => w.id !== word.id && w[field] !== answer))
        .slice(0, 3)
        .map(w => w[field]);

    return {
        word,
        kind: 'choice',
        prompt: byTerm ? word.term : word.meaning,
        sub: byTerm ? '选择正确的释义' : '选择正确的单词',
        answer,
        options: shuffle([answer, ...distractors])
    };
}

function buildQuizQuestions() {
    const pool = quizPool();
    if (!pool.length) return [];

    const picked = shuffle(pool.slice()).slice(0, quizLimit(pool.length));
    return picked.map(makeQuizQuestion);
}

function startQuiz() {
    const questions = buildQuizQuestions();
    if (!questions.length) return toast('还没有可用于考核的单词，请先补充释义', 'error');

    quiz.questions = questions;
    quiz.index = 0;
    quiz.correct = 0;
    quiz.wrong = [];
    quiz.answered = false;
    quiz.pending = null;
    quiz.questionEndsAt = 0;
    quiz.sessionPromise = null;
    quiz.warned = false;

    els.quizSetup.hidden = true;
    els.quizResult.hidden = true;
    els.quizRun.hidden = false;
    if (quiz.type === 'meaning') warmUpDictionary();
    startQuizTimer();
    renderQuizQuestion();
}

// 从「单词」列表勾选后跳到考核设置页：范围自动切到「选中」，题量默认就等于选中数量
function quizSelected() {
    const usable = wordsState.words
        .filter(word => wordsState.selected.has(word.id))
        .filter(word => word.term && word.meaning);

    if (!usable.length) return toast('选中的单词都没有释义，无法考核', 'error');

    quiz.override = usable;
    quiz.scope = 'selected';
    quiz.customSize = usable.length;
    quiz.customFromSelection = true;
    els.quizSizeInput.value = String(usable.length);

    // openDetailTab('quiz') 会回到设置页并刷新范围 / 题量 / 提示（这里刻意不直接开考）
    openDetailTab('quiz');
}

function renderQuizProgress() {
    els.quizProgress.textContent = `第 ${quiz.index + 1} / ${quiz.questions.length} 题 · 答对 ${quiz.correct}`;
}

function renderQuizQuestion() {
    const question = quiz.questions[quiz.index];
    if (!question) return finishQuiz();

    quiz.answered = false;
    quiz.pending = null;
    renderQuizProgress();
    els.quizPrompt.textContent = question.prompt;
    els.quizSub.textContent = question.sub;
    els.quizFeedback.hidden = true;
    els.quizOverride.hidden = true;
    els.quizNext.hidden = true;
    els.quizOptions.replaceChildren();

    // 限时：每一题单独起算；不限时就只显示总用时
    if (quiz.limitSeconds) {
        quiz.questionEndsAt = Date.now() + quiz.limitSeconds * 1000;
        els.quizCountdown.hidden = false;
    } else {
        els.quizCountdown.hidden = true;
    }
    tickQuizTimer();

    const choice = question.kind === 'choice';
    els.quizOptions.hidden = !choice;
    els.quizSpell.hidden = choice;

    if (choice) {
        question.options.forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quiz-option';
            btn.textContent = option;
            btn.addEventListener('click', () => answerChoice(question, btn, option));
            els.quizOptions.appendChild(btn);
        });
    } else {
        els.quizInput.value = '';
        els.quizInput.disabled = false;
        els.quizSubmit.disabled = false;
        els.quizInput.placeholder = question.kind === 'meaning' ? '输入中文意思后回车' : '输入对应的单词后回车';
        els.quizInput.focus();
    }
}

function answerChoice(question, btn, value) {
    if (quiz.answered) return;
    quiz.answered = true;

    $$('.quiz-option', els.quizOptions).forEach(el => {
        el.disabled = true;
        if (el.textContent === question.answer) el.classList.add('correct');
        else if (el === btn) el.classList.add('wrong');
    });

    resolveQuizAnswer(question, value === question.answer, value);
}

function submitTyped() {
    const question = quiz.questions[quiz.index];
    if (!question || question.kind === 'choice' || quiz.answered) return;

    const value = els.quizInput.value.trim();
    if (!value) return toast('请输入答案', 'error');

    els.quizInput.disabled = true;
    els.quizSubmit.disabled = true;

    // 填义题：自动判对就直接计入；判错先只记下判定，留一次手动纠正的机会
    if (question.kind === 'meaning') {
        quiz.answered = true;
        if (judgeMeaning(value, question.answer, question.word.term)) {
            resolveQuizAnswer(question, true, value);
        } else {
            quiz.pending = { question, given: value, correct: false };
            renderAnswerFeedback(question, false);
        }
        return;
    }

    quiz.answered = true;
    resolveQuizAnswer(question, value.toLowerCase() === question.answer.trim().toLowerCase(), value);
}

function resolveQuizAnswer(question, correct, given) {
    commitQuizAnswer(question, correct, given);
    renderAnswerFeedback(question, correct);
}

function commitQuizAnswer(question, correct, given) {
    applyQuizResult(question.word, correct);

    if (correct) {
        quiz.correct += 1;
    } else {
        quiz.wrong.push({ prompt: question.prompt, answer: question.answer, given });
    }
}

function renderAnswerFeedback(question, correct, timedOut = false) {
    // 记下这次是怎么画的，改完词条要照原样重画（见 refreshQuizWord）
    quiz.lastRender = { correct, timedOut };

    els.quizCountdown.hidden = true;
    els.quizFeedback.hidden = false;
    els.quizFeedback.className = `quiz-feedback ${correct ? 'ok' : 'no'}`;
    els.quizFeedback.replaceChildren();

    // 填义题自动判错后，判定由用户自己来回改；真正的记分留到「下一题」，
    // 所以点错了随时能点回来，也不会在服务端留下记录
    const pending = quiz.pending;

    const message = document.createElement('span');
    if (timedOut) message.textContent = `超时了，正确答案：${question.answer}`;
    else if (pending && pending.correct) message.textContent = '已按答对算，点「下一题」确定';
    else if (correct) message.textContent = '答对了！';
    else message.textContent = `答错了，正确答案：${question.answer}`;
    els.quizFeedback.appendChild(message);

    // 作答后才显示音标与发音，免得拼写题被直接提示答案
    const ipa = phoneticOf(question.word.term);
    if (ipa) {
        const phonetic = document.createElement('span');
        phonetic.className = 'inline-phonetic';
        phonetic.textContent = ipa;
        els.quizFeedback.appendChild(phonetic);
    }
    els.quizFeedback.appendChild(makeSpeakButton(question.word.term));
    els.quizFeedback.appendChild(makeFixLink({
        word: question.word,
        term: question.word.term,
        meaning: question.word.meaning,
        source: 'quiz'
    }, refreshQuizWord));

    renderQuizProgress();

    els.quizOverride.hidden = !pending;
    els.quizOverride.textContent = pending && pending.correct ? '点错了，改回算错' : '我答对了，算对';

    els.quizNext.hidden = false;
    els.quizNext.textContent = quiz.index + 1 >= quiz.questions.length ? '查看结果' : '下一题';
    els.quizNext.focus();
}

// 反馈区里改完词条：按新词重算当前题目，再照原来的判定重画反馈
// （题干与「正确答案」都是构建时的字符串，不重算会停在旧释义上）
function refreshQuizWord() {
    const question = quiz.questions[quiz.index];
    if (!question || !question.word) return;

    Object.assign(question, makeQuizQuestion(question.word));
    els.quizPrompt.textContent = question.prompt;
    els.quizSub.textContent = question.sub;

    const last = quiz.lastRender || { correct: false, timedOut: false };
    renderAnswerFeedback(question, last.correct, last.timedOut);
}

// 填义被自动判错后点「我答对了」：这里只翻转判定，不记分，
// 点错了再点一次就改回去；等点「下一题」才真正落账
function acceptQuizMeaning() {
    const pending = quiz.pending;
    if (!pending) return;

    pending.correct = !pending.correct;
    renderAnswerFeedback(pending.question, pending.correct);
}

function nextQuestion() {
    if (!quiz.answered) return;

    // 填义题的判定（自动判错又被手动改过的）到这里才落账
    if (quiz.pending) {
        const pending = quiz.pending;
        quiz.pending = null;
        commitQuizAnswer(pending.question, !!pending.correct, pending.given);
    }

    quiz.index += 1;
    if (quiz.index >= quiz.questions.length) finishQuiz();
    else renderQuizQuestion();
}

function finishQuiz() {
    const total = quiz.questions.length;
    const rate = total ? Math.round((quiz.correct / total) * 100) : 0;
    const used = formatHMS(quizElapsedMs());

    stopQuizTimer();
    els.quizRun.hidden = true;
    els.quizResult.hidden = false;
    renderSummary(els.quizResult, [
        ['答对', quiz.correct],
        ['答错', quiz.wrong.length],
        ['正确率', `${rate}%`],
        ['用时', used]
    ], `考核完成，得分 ${rate} 分 · 用时 ${used}`);

    const answered = quiz.correct + quiz.wrong.length;
    if (answered) recordStudyTask(`📝 考核：${studyBookName()}（${answered} 题 · 正确率 ${rate}%）`);

    if (quiz.wrong.length) {
        const list = document.createElement('div');
        list.className = 'wrong-list';

        quiz.wrong.forEach(item => {
            const row = document.createElement('div');
            row.className = 'wrong-item';

            const prompt = document.createElement('span');
            prompt.className = 'wrong-prompt';
            prompt.textContent = item.prompt;

            const answer = document.createElement('span');
            answer.className = 'wrong-answer';
            answer.textContent = item.answer;

            row.append(prompt, answer);
            list.appendChild(row);
        });

        els.quizResult.appendChild(list);
    }

    const actions = document.createElement('div');
    actions.className = 'timer-actions';

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn-primary';
    again.textContent = '再考一次';
    again.addEventListener('click', startQuiz);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-ghost';
    back.textContent = '返回设置';
    back.addEventListener('click', resetQuizSetup);

    actions.append(again, back);
    els.quizResult.appendChild(actions);

    renderDetailStats();
}

/* ---------------- 消灭错词 ---------------- */

// 错词 = 答错过、且还没达到「已掌握」的词（复用同一套判定）。
// 灭错就是反复练这些词：答对一次即掌握、从错词池消失；答错清零并排回队尾。
const elim = {
    type: 'choice',
    queue: [],
    total: 0,
    current: null,
    answered: false,
    // 填义题自动判错时暂存本次作答，等用户确认「我答对了」或点下一题才落账
    pending: null,
    sessionPromise: null,
    warned: false
};

function wrongWordStats() {
    const wrong = wordsState.words.filter(word => word.wrong_count > 0);
    const pending = wrong.filter(isWrongWord);
    return {
        pending,
        cleared: wrong.length - pending.length,
        misses: wordsState.words.reduce((sum, word) => sum + word.wrong_count, 0)
    };
}

// 灭错题必须有释义才出得来，缺释义的错词只能先跳过
function elimPool() {
    return wordsState.words.filter(word => isWrongWord(word) && word.term && word.meaning);
}

function usableWords() {
    return wordsState.words.filter(word => word.term && word.meaning);
}

function updateWrongTabLabel() {
    if (!els.wrongTab) return;
    const { pending } = wrongWordStats();
    els.wrongTab.textContent = pending.length ? `错词 ${pending.length}` : '错词';
}

function syncElimType() {
    $$('#elimTypeGroup button').forEach(btn => btn.classList.toggle('active', btn.dataset.type === elim.type));
}

function resetElimRun() {
    els.wrongSetup.hidden = false;
    els.wrongRun.hidden = true;
    els.wrongDone.hidden = true;
    els.wrongDone.replaceChildren();
}

function renderWrongTab() {
    resetElimRun();
    syncElimType();
    refreshWrongStats();
}

function refreshWrongStats() {
    const { pending, cleared, misses } = wrongWordStats();

    els.wrongStats.replaceChildren(
        statItem('🎯', pending.length, '待消灭', `答错过、还没达到「已掌握」的单词（答对一次即消灭）`),
        statItem('✅', cleared, '已消灭'),
        statItem('📉', misses, '累计答错')
    );
    updateWrongTabLabel();

    const drillable = pending.filter(word => word.term && word.meaning).length;
    const missing = pending.length - drillable;

    if (!wordsState.words.length) {
        els.wrongHint.textContent = '这个本子还没有单词，先导入一份单词表吧。';
        els.wrongStart.disabled = true;
    } else if (!pending.length) {
        els.wrongHint.textContent = '这个本子的错词已经全部消灭，继续保持～（消灭过的词仍然能在「单词」页的「错词」筛选里看到）';
        els.wrongStart.disabled = true;
    } else if (!drillable) {
        els.wrongHint.textContent = '待消灭的错词都没有释义，补上释义后就能出题了。';
        els.wrongStart.disabled = true;
    } else {
        const notes = [`共 ${drillable} 个待消灭的错词，答对一次即消灭；答错清零并排到队尾继续练。`];
        if (missing) notes.push(`另有 ${missing} 个错词没有释义，已跳过。`);
        if (elim.type === 'choice' && usableWords().length < 4) {
            notes.push('带释义的单词不足 4 个，请改用「拼写」。');
        }
        if (elim.type === 'meaning') {
            notes.push('填义题按中文意思自动判分，判错时可点「我答对了，算对」纠正。');
        }
        els.wrongHint.textContent = notes.join(' ');
        els.wrongStart.disabled = false;
    }
}

function startElim() {
    const pool = elimPool();
    if (!pool.length) return toast('没有待消灭的错词', 'error');
    if (elim.type === 'choice' && usableWords().length < 4) {
        return toast('带释义的单词不足 4 个，无法生成选择题，请改用「拼写」', 'error');
    }

    elim.queue = shuffle(pool.slice());
    elim.total = elim.queue.length;
    elim.current = null;
    elim.answered = false;
    elim.pending = null;
    elim.sessionPromise = null;
    elim.warned = false;

    els.wrongSetup.hidden = true;
    els.wrongDone.hidden = true;
    els.wrongRun.hidden = false;
    if (elim.type === 'meaning') warmUpDictionary();
    renderElimQuestion();
}

function buildElimQuestion(word) {
    if (elim.type === 'spell') {
        return { word, kind: 'spell', prompt: word.meaning, sub: '根据释义拼写单词', answer: word.term };
    }
    if (elim.type === 'meaning') {
        return { word, kind: 'meaning', prompt: word.term, sub: '写出这个单词的中文意思', answer: word.meaning };
    }

    const answer = word.meaning;
    const distractors = shuffle(usableWords().filter(w => w.id !== word.id && w.meaning !== answer))
        .slice(0, 3)
        .map(w => w.meaning);

    return {
        word,
        kind: 'choice',
        prompt: word.term,
        sub: '选择正确的释义',
        answer,
        options: shuffle([answer, ...distractors])
    };
}

function renderElimProgress() {
    const remaining = elim.queue.length;
    els.wrongProgress.textContent = `剩余 ${remaining} 个 · 已消灭 ${elim.total - remaining} / ${elim.total}`;
}

function renderElimQuestion() {
    const word = elim.queue[0];
    if (!word) return finishElim();

    const question = buildElimQuestion(word);
    elim.current = question;
    elim.answered = false;
    elim.pending = null;

    renderElimProgress();
    els.wrongFeedback.hidden = true;
    els.wrongOverride.hidden = true;
    els.wrongNext.hidden = true;
    els.wrongOptions.replaceChildren();
    els.wrongPrompt.textContent = question.prompt;
    els.wrongSub.textContent = question.sub;

    const choice = question.kind === 'choice';
    els.wrongOptions.hidden = !choice;
    els.wrongSpell.hidden = choice;

    if (choice) {
        question.options.forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quiz-option';
            btn.textContent = option;
            btn.addEventListener('click', () => answerElimChoice(question, btn, option));
            els.wrongOptions.appendChild(btn);
        });
    } else {
        els.wrongInput.value = '';
        els.wrongInput.disabled = false;
        els.wrongSubmit.disabled = false;
        els.wrongInput.placeholder = question.kind === 'meaning' ? '输入中文意思后回车' : '输入对应的单词后回车';
        els.wrongInput.focus();
    }
}

function answerElimChoice(question, btn, value) {
    if (elim.answered) return;
    elim.answered = true;

    $$('.quiz-option', els.wrongOptions).forEach(el => {
        el.disabled = true;
        if (el.textContent === question.answer) el.classList.add('correct');
        else if (el === btn) el.classList.add('wrong');
    });

    resolveElimAnswer(question, value === question.answer);
}

function submitElimTyped() {
    const question = elim.current;
    if (!question || question.kind === 'choice' || elim.answered) return;

    const value = els.wrongInput.value.trim();
    if (!value) return toast('请输入答案', 'error');

    els.wrongInput.disabled = true;
    els.wrongSubmit.disabled = true;

    // 填义题：自动判对就直接计入；判错先只记下判定，留一次手动纠正的机会
    if (question.kind === 'meaning') {
        elim.answered = true;
        if (judgeMeaning(value, question.answer, question.word.term)) {
            resolveElimAnswer(question, true);
        } else {
            elim.pending = { question, given: value, correct: false };
            renderElimFeedback(question, false);
        }
        return;
    }

    elim.answered = true;
    resolveElimAnswer(question, value.toLowerCase() === question.answer.trim().toLowerCase());
}

function resolveElimAnswer(question, correct) {
    commitElimAnswer(question, correct);
    renderElimFeedback(question, correct);
}

// 记一次作答并移动队列。答对就 +MASTERY_TARGET，必然达到掌握线，所以答对即消灭；
// 答错清零并排到队尾继续练
function commitElimAnswer(question, correct) {
    const word = question.word;
    applyElimResult(word, correct);

    const eliminated = correct && word.mastery >= MASTERY_TARGET;
    elim.queue.shift();
    if (!eliminated) elim.queue.push(word);

    renderElimProgress();
    refreshWrongStats();
}

function renderElimFeedback(question, correct) {
    const word = question.word;

    // 记下这次是怎么画的，改完词条要照原样重画（见 refreshElimWord）
    elim.lastRender = { correct };

    els.wrongFeedback.hidden = false;
    els.wrongFeedback.className = `quiz-feedback ${correct ? 'ok' : 'no'}`;
    els.wrongFeedback.replaceChildren();

    // 同考核：填义自动判错后判定可以来回改，记分与队列移动都留到「下一题」
    const pending = elim.pending;

    const message = document.createElement('span');
    if (pending && pending.correct) message.textContent = '已按答对算，点「下一题」确定';
    else if (!correct) message.textContent = `答错了，正确答案：${question.answer}`;
    else message.textContent = '答对了，已消灭！';
    els.wrongFeedback.appendChild(message);

    const ipa = phoneticOf(word.term);
    if (ipa) {
        const phonetic = document.createElement('span');
        phonetic.className = 'inline-phonetic';
        phonetic.textContent = ipa;
        els.wrongFeedback.appendChild(phonetic);
    }
    els.wrongFeedback.appendChild(makeSpeakButton(word.term));
    els.wrongFeedback.appendChild(makeFixLink({
        word,
        term: word.term,
        meaning: word.meaning,
        source: 'elim'
    }, refreshElimWord));

    els.wrongOverride.hidden = !pending;
    els.wrongOverride.textContent = pending && pending.correct ? '点错了，改回算错' : '我答对了，算对';

    els.wrongNext.hidden = false;
    els.wrongNext.textContent = elim.queue.length ? '下一题' : '查看结果';
    els.wrongNext.focus();
}

// 反馈区里改完词条：按新词重建当前题目，再照原来的判定重画反馈
function refreshElimWord() {
    const word = elim.queue[0];
    if (!word) return;

    elim.current = buildElimQuestion(word);
    els.wrongPrompt.textContent = elim.current.prompt;
    els.wrongSub.textContent = elim.current.sub;

    const last = elim.lastRender || { correct: false };
    renderElimFeedback(elim.current, last.correct);
}

// 填义被自动判错后点「我答对了」：只翻转判定，点错了再点一次就改回去
function acceptElimOverride() {
    const pending = elim.pending;
    if (!pending) return;

    pending.correct = !pending.correct;
    renderElimFeedback(pending.question, pending.correct);
}

function nextElim() {
    if (!elim.answered) return;

    // 判定到这里才落账（会移动队列、更新熟练度）
    if (elim.pending) {
        const pending = elim.pending;
        elim.pending = null;
        commitElimAnswer(pending.question, !!pending.correct);
    }

    if (!elim.queue.length) finishElim();
    else renderElimQuestion();
}

function finishElim() {
    const cleared = elim.total - elim.queue.length;
    const { pending } = wrongWordStats();
    const rest = elimPool();

    els.wrongRun.hidden = true;
    els.wrongDone.hidden = false;
    els.wrongDone.replaceChildren();

    renderSummary(els.wrongDone, [
        ['本轮消灭', cleared],
        ['待消灭', pending.length]
    ], pending.length ? '本轮结束' : '🎉 错词全部消灭！');

    if (cleared) recordStudyTask(`🎯 消灭错词：${studyBookName()}（消灭 ${cleared} 个）`);

    const actions = document.createElement('div');
    actions.className = 'timer-actions';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = rest.length ? 'btn-ghost' : 'btn-primary';
    back.textContent = '返回设置';
    back.addEventListener('click', () => {
        resetElimRun();
        refreshWrongStats();
    });
    actions.appendChild(back);

    // 还有可练的错词才给「继续消灭」，否则点了也是空跑
    if (rest.length) {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn-primary';
        again.textContent = '继续消灭';
        again.addEventListener('click', startElim);
        actions.prepend(again);
    }

    els.wrongDone.appendChild(actions);

    refreshWrongStats();
    renderDetailStats();
}

function applyElimResult(word, correct) {
    word.review_count += 1;
    if (correct) {
        word.correct_count += 1;
        word.mastery = Math.min(5, word.mastery + MASTERY_TARGET);
        word.last_result = 'known';
    } else {
        word.wrong_count += 1;
        word.mastery = 0;
        word.last_result = 'again';
    }
    logReview('quiz', elim, word, correct ? 'known' : 'again', elim.total);
}

/* ---------------- 共用 ---------------- */

// 背完 / 考完 / 灭完：先看当天学习累计够不够自动打卡（够就补一条打卡），
// 再把这一轮记进「今天的打卡任务」（算已完成）——
// 没打卡时 addStudyTask 仍会静默跳过，所以顺序必须是「先打卡再记任务」
function recordStudyTask(text) {
    api.autoCheckin()
        .catch(() => ({ checkin: null }))
        .then(({ checkin }) => {
            if (checkin) toast(`📚 今日学习满 ${AUTO_CHECKIN_WORDS} 个单词，已自动打卡！`, 'success');
            return api.tasks.addStudyTask(text);
        })
        .then(({ task }) => {
            if (task) toast(`已记入今日任务：${text}`, 'success');
        })
        .catch(() => {
            /* 记不上不影响学习本身 */
        });
}

function studyBookName() {
    return (wordsState.current && wordsState.current.name) || '单词本';
}

// 记录写入失败只提示一次，避免每答一题弹一次
function warnRecordFailure(state, message) {
    if (state.warned) return;
    state.warned = true;
    toast(message, 'error');
}

// 一次作答 → 写学习记录（会话 id 懒创建，同一轮复用）
// 进度与记录都不是关键路径：不 await，失败也不打断背诵/答题节奏
function logReview(mode, state, word, result, total) {
    const book = wordsState.current;

    if (!state.sessionPromise) {
        state.sessionPromise = api.wordbooks
            .startSession({ mode, bookId: book && book.id, bookName: book && book.name, total })
            // 建会话失败也要能记单词进度，只是这一轮不会有明细
            .catch(err => {
                warnRecordFailure(state, `学习记录写入失败：${err.message}（单词进度仍会保存）`);
                return null;
            });
    }

    state.sessionPromise
        .then(sessionId => api.wordbooks.recordReview(sessionId, word.id, result))
        .then(row => {
            if (!row) return;
            // 同一轮里同一个词可能被反复作答（灭错会把它排回队尾），
            // 旧请求的响应可能后到；按作答次数丢弃过期结果，别把熟练度覆盖回去
            if (row.review_count < word.review_count) return;
            // 熟练度由服务端计算，用返回值覆盖本地的乐观更新
            word.mastery = row.mastery;
            word.review_count = row.review_count;
            word.correct_count = row.correct_count;
            word.wrong_count = row.wrong_count;
            word.last_result = row.last_result || '';
        })
        .catch(err => warnRecordFailure(state, `学习记录保存失败：${err.message}`));
}

function applyQuizResult(word, correct) {
    word.review_count += 1;
    if (correct) {
        word.correct_count += 1;
        word.mastery = Math.min(5, word.mastery + MASTERY_TARGET);
        word.last_result = 'known';
    } else {
        word.wrong_count += 1;
        word.mastery = 0;
        word.last_result = 'again';
    }
    logReview('quiz', quiz, word, correct ? 'known' : 'again', quiz.questions.length);
}

function renderSummary(host, items, titleText) {
    host.replaceChildren();

    const title = document.createElement('div');
    title.className = 'summary-title';
    title.textContent = titleText;

    const grid = document.createElement('div');
    grid.className = 'summary-grid';

    items.forEach(([label, value]) => {
        const cell = document.createElement('div');
        cell.className = 'summary-cell';

        const valueEl = document.createElement('div');
        valueEl.className = 'summary-value';
        valueEl.textContent = value;

        const labelEl = document.createElement('div');
        labelEl.className = 'summary-label';
        labelEl.textContent = label;

        cell.append(valueEl, labelEl);
        grid.appendChild(cell);
    });

    host.append(title, grid);
}

/* ---------------- 学习记录 ---------------- */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const recordsState = { kind: 'all', sessions: [] };

function dayKeyOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDayLabel(key) {
    const today = dayKeyOf(new Date());
    if (key === today) return '今天';

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === dayKeyOf(yesterday)) return '昨天';

    const [y, m, d] = key.split('-').map(Number);
    return `${m} 月 ${d} 日 ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`;
}

function formatClock(iso) {
    const date = new Date(iso);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// 实际作答的数量：会话在第一次作答时才创建，中途退出就会少于 total
function sessionAnswered(session) {
    return session.known + session.vague + session.again;
}

function sessionMetaText(session) {
    const count = sessionAnswered(session);
    if (session.mode === 'quiz') {
        const rate = count ? Math.round((session.correct / count) * 100) : 0;
        return `共 ${count} 题 · 对 ${session.correct} · 错 ${session.wrong} · 正确率 ${rate}%`;
    }
    return `共 ${count} 个 · 认识 ${session.known} · 模糊 ${session.vague} · 不认识 ${session.again}`;
}

function openRecords() {
    recordsState.kind = 'all';
    $$('#recordsFilter button').forEach(btn => btn.classList.toggle('active', btn.dataset.kind === 'all'));
    showWordView('records');

    els.recordsToday.replaceChildren();
    els.recordsEmpty.hidden = true;
    els.recordList.replaceChildren(skeletonRows(3));

    // 每次打开都重新拉，刚背完的记录立刻能看到
    api.wordbooks
        .records(200)
        .then(sessions => {
            recordsState.sessions = sessions;
            renderRecords();
        })
        .catch(err => {
            els.recordList.replaceChildren();
            els.recordsEmpty.hidden = false;
            els.recordsEmpty.textContent = err.message;
            toast(err.message, 'error');
        });
}

function renderRecords() {
    renderRecordsToday();
    renderRecordList();
}

function renderRecordsToday() {
    const today = dayKeyOf(new Date());
    const todays = recordsState.sessions.filter(session => dayKeyOf(new Date(session.createdAt)) === today);

    const studyCount = todays
        .filter(session => session.mode === 'study')
        .reduce((sum, session) => sum + sessionAnswered(session), 0);
    const quizSessions = todays.filter(session => session.mode === 'quiz');
    const quizCount = quizSessions.reduce((sum, session) => sum + sessionAnswered(session), 0);
    const quizCorrect = quizSessions.reduce((sum, session) => sum + session.correct, 0);
    const rate = quizCount ? Math.round((quizCorrect / quizCount) * 100) : 0;

    els.recordsToday.replaceChildren(
        statItem('📖', studyCount, '今日背诵'),
        statItem('📝', quizCount, '今日考核'),
        statItem('🎯', `${rate}%`, '今日正确率')
    );
}

function renderRecordList() {
    const sessions = recordsState.sessions.filter(
        session => recordsState.kind === 'all' || session.mode === recordsState.kind
    );

    els.recordList.replaceChildren();

    if (!sessions.length) {
        els.recordsEmpty.hidden = false;
        els.recordsEmpty.textContent = recordsState.sessions.length
            ? '这个筛选下还没有记录'
            : '还没有记录，先去背几个单词吧';
        return;
    }
    els.recordsEmpty.hidden = true;

    // 接口已按时间倒序返回，顺序扫一遍即可按天分组
    const groups = new Map();
    sessions.forEach(session => {
        const key = dayKeyOf(new Date(session.createdAt));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(session);
    });

    const fragment = document.createDocumentFragment();
    groups.forEach((items, key) => fragment.appendChild(renderRecordDay(key, items)));
    els.recordList.appendChild(fragment);
}

function renderRecordDay(key, sessions) {
    const day = document.createElement('div');
    day.className = 'record-day';

    const head = document.createElement('div');
    head.className = 'record-day-head';

    const date = document.createElement('span');
    date.className = 'record-date';
    date.textContent = formatDayLabel(key);

    const sum = document.createElement('span');
    sum.className = 'record-day-sum';

    const parts = [];
    const studySessions = sessions.filter(session => session.mode === 'study');
    const quizSessions = sessions.filter(session => session.mode === 'quiz');
    if (studySessions.length) parts.push(`背诵 ${studySessions.reduce((sum, s) => sum + sessionAnswered(s), 0)} 个`);
    if (quizSessions.length) parts.push(`考核 ${quizSessions.reduce((sum, s) => sum + sessionAnswered(s), 0)} 题`);
    sum.textContent = parts.join(' · ');

    head.append(date, sum);

    const list = document.createElement('div');
    list.className = 'record-sessions';
    sessions.forEach(session => list.appendChild(renderRecordItem(session)));

    day.append(head, list);
    return day;
}

function renderRecordItem(session) {
    const wrap = document.createElement('div');
    wrap.className = 'record-item';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'record-head';

    const badge = document.createElement('span');
    badge.className = `record-badge record-badge-${session.mode}`;
    badge.textContent = session.mode === 'quiz' ? '考核' : '背诵';

    const main = document.createElement('span');
    main.className = 'record-main';

    const book = document.createElement('span');
    book.className = 'record-book';
    book.textContent = session.bookName || '（单词本已删除）';

    const meta = document.createElement('span');
    meta.className = 'record-meta';
    meta.textContent = sessionMetaText(session);

    main.append(book, meta);

    const time = document.createElement('span');
    time.className = 'record-time';
    time.textContent = formatClock(session.createdAt);

    head.append(badge, main, time);

    // 明细在独立的详情页里看，这里只负责跳过去
    head.addEventListener('click', () => {
        location.href = `${PAGES.record}?id=${encodeURIComponent(session.id)}`;
    });

    wrap.append(head);
    return wrap;
}

/* ---------------- 导出学习记录 ---------------- */

// 下载文件：Blob + 临时 <a download>，和头像裁剪那边用 objectURL 的做法一致
function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 下载是异步的，立刻回收会把文件掐断，留一会儿再释放
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
    // 开头加 BOM，Excel 打开中文才不乱码
    const text = `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    downloadText(filename, text, 'text/csv;charset=utf-8');
}

function formatRecordTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    return `${dayKeyOf(date)} ${formatClock(iso)}`;
}

function formatStamp(date = new Date()) {
    return `${dayKeyOf(date)} ${formatClock(date)}`;
}

const WRONG_WORD_COLUMNS = ['单词', '释义', '错误次数', '正确次数', '复习次数', '最近结果', '最近复习时间', '单词本'];

// 错词表的数据行：CSV 和 PDF 共用，少写一份
function wrongWordRows(words, books) {
    const bookNames = new Map(books.map(book => [book.id, book.name]));

    return words.map(word => [
        word.term,
        word.meaning || '',
        word.wrong_count,
        word.correct_count,
        word.review_count,
        STATUS_LABELS[word.last_result] || '未背',
        formatRecordTime(word.last_reviewed_at),
        bookNames.get(word.book_id) || ''
    ]);
}

async function loadWrongWords() {
    const [words, books] = await Promise.all([api.wordbooks.wrongWords(), api.wordbooks.list()]);
    return { words, rows: wrongWordRows(words, books) };
}

// 导出所有答错过的单词（跨单词本）以及各自错了几次
async function exportWrongCsv() {
    setLoading(els.recordsCsv, true);

    try {
        const { words, rows } = await loadWrongWords();

        if (!words.length) {
            toast('还没有答错过的单词', 'info');
            return;
        }

        downloadCsv(`错词记录-${dayKeyOf(new Date())}.csv`, [WRONG_WORD_COLUMNS, ...rows]);
        toast(`已导出 ${words.length} 个错词`, 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.recordsCsv, false);
    }
}

/* ---------------- 导出 PDF ---------------- */

// 逐词明细拉太多会慢，只给最近这么多次会话排明细，更早的看按天汇总
const PRINT_DETAIL_SESSIONS = 80;
// 明细总行数上限，防止一本上千词的背诵把报告撑爆
const PRINT_DETAIL_ROWS = 8000;
const PRINT_CONCURRENCY = 4;
const RECORD_KIND_LABELS = { all: '全部', study: '背诵', quiz: '考核' };

function printEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

// 第一行当表头，其余当数据
function printTable(headers, rows, className) {
    const table = printEl('table', className ? `print-table ${className}` : 'print-table');

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach(text => headRow.appendChild(printEl('th', null, text)));
    head.appendChild(headRow);

    const body = document.createElement('tbody');
    rows.forEach(cells => {
        const row = document.createElement('tr');
        cells.forEach(cell => row.appendChild(printEl('td', null, cell)));
        body.appendChild(row);
    });

    table.append(head, body);
    return table;
}

function showExportStatus(text) {
    els.recordsExportStatus.textContent = text;
    els.recordsExportStatus.hidden = false;
}

function hideExportStatus() {
    els.recordsExportStatus.hidden = true;
}

// 按并发上限一批批拉每次会话的逐词明细，顺便报进度
async function loadSessionLogs(sessions, onProgress) {
    const logs = new Map();
    const queue = sessions.slice();
    let done = 0;

    async function worker() {
        while (queue.length) {
            const session = queue.shift();
            try {
                logs.set(session.id, await api.wordbooks.sessionLogs(session.id));
            } catch {
                // 单条明细读失败不影响整份报告
                logs.set(session.id, null);
            }
            done += 1;
            onProgress(done, sessions.length);
        }
    }

    const workers = Math.min(PRINT_CONCURRENCY, queue.length || 1);
    await Promise.all(Array.from({ length: workers }, worker));
    return logs;
}

function printSessionBlock(session, sessionLogs, budget) {
    const box = printEl('div', 'print-session');

    const head = printEl('div', 'print-session-head');
    head.appendChild(printEl('b', null, formatClock(session.createdAt)));
    head.appendChild(document.createTextNode(
        ` ${session.mode === 'quiz' ? '考核' : '背诵'} · ${session.bookName || '（单词本已删除）'} · ${sessionMetaText(session)}`
    ));
    box.appendChild(head);

    // undefined = 这次不在明细范围内
    if (sessionLogs === undefined) return box;

    if (sessionLogs === null) {
        box.appendChild(printEl('p', 'print-note', '（这次明细读取失败）'));
        return box;
    }

    if (!sessionLogs.length) {
        box.appendChild(printEl('p', 'print-note', '（这次没有留下单词明细）'));
        return box;
    }

    if (budget.left <= 0) {
        box.appendChild(printEl('p', 'print-note', `（共 ${sessionLogs.length} 个词，明细已到上限，不再展开）`));
        return box;
    }

    const shown = sessionLogs.slice(0, budget.left);
    budget.left -= shown.length;

    const rows = shown.map(log => [
        log.term,
        log.meaning || '—',
        session.mode === 'quiz'
            ? (log.result === 'known' ? '答对' : '答错')
            : (STATUS_LABELS[log.result] || log.result)
    ]);

    const table = printTable(['单词', '释义', '结果'], rows, 'print-logs');
    [...table.tBodies[0].rows].forEach((row, index) => {
        if (shown[index].result === 'again') row.classList.add('print-bad');
    });
    box.appendChild(table);

    if (shown.length < sessionLogs.length) {
        box.appendChild(printEl('p', 'print-note', `（本次共 ${sessionLogs.length} 个词，这里只列了前 ${shown.length} 个）`));
    }

    return box;
}

function buildPrintReport({ sessions, logs, words, rows, detailCount, budget }) {
    const report = printEl('div', 'print-report');

    const head = printEl('div', 'print-head');
    head.appendChild(printEl('h1', null, '学习记录'));
    head.appendChild(printEl('p', 'print-meta',
        `导出时间 ${formatStamp()} · 范围：${RECORD_KIND_LABELS[recordsState.kind] || '全部'} · 共 ${sessions.length} 条记录`));
    report.appendChild(head);

    // 概览
    const studyCount = sessions
        .filter(session => session.mode === 'study')
        .reduce((sum, session) => sum + sessionAnswered(session), 0);
    const quizzes = sessions.filter(session => session.mode === 'quiz');
    const quizCount = quizzes.reduce((sum, session) => sum + sessionAnswered(session), 0);
    const quizCorrect = quizzes.reduce((sum, session) => sum + session.correct, 0);
    const rate = quizCount ? Math.round((quizCorrect / quizCount) * 100) : 0;
    const misses = words.reduce((sum, word) => sum + word.wrong_count, 0);

    const overview = printEl('div', 'print-summary');
    overview.appendChild(printEl('p', null, `共 ${sessions.length} 次学习记录 · 背诵 ${studyCount} 个 · 考核 ${quizCount} 题（正确率 ${rate}%）`));
    overview.appendChild(printEl('p', null, `答错过的单词 ${words.length} 个 · 累计答错 ${misses} 次`));
    report.appendChild(overview);

    // 一、错词表
    report.appendChild(printEl('h2', null, `一、错词表（${words.length} 个）`));
    report.appendChild(words.length
        ? printTable(WRONG_WORD_COLUMNS, rows)
        : printEl('p', 'print-note', '还没有答错过的单词。'));

    // 二、学习记录
    report.appendChild(printEl('h2', null, '二、学习记录（按天）'));

    if (!sessions.length) {
        report.appendChild(printEl('p', 'print-note', '这个范围内还没有记录。'));
        return report;
    }

    // 接口已按时间倒序返回，顺序扫一遍即可按天分组
    const groups = new Map();
    sessions.forEach(session => {
        const key = dayKeyOf(new Date(session.createdAt));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(session);
    });

    groups.forEach((items, key) => {
        report.appendChild(printEl('h3', null, `${formatDayLabel(key)}（${items.length} 次）`));
        items.forEach(session => report.appendChild(printSessionBlock(session, logs.get(session.id), budget)));
    });

    if (sessions.length > detailCount) {
        report.appendChild(printEl('p', 'print-note',
            `逐词明细只列最近 ${detailCount} 次，更早的记录请看上面的按天汇总。`));
    }

    return report;
}

// 报告生成好挂到 body 下，用浏览器打印；在打印窗口里把目标选成「另存为 PDF」即可
async function exportLearningPdf() {
    const sessions = recordsState.sessions.filter(
        session => recordsState.kind === 'all' || session.mode === recordsState.kind
    );

    setLoading(els.recordsPdf, true);
    showExportStatus('正在整理数据…');

    try {
        const { words, rows } = await loadWrongWords();

        const detailed = sessions.filter(sessionAnswered).slice(0, PRINT_DETAIL_SESSIONS);
        const logs = await loadSessionLogs(detailed, (done, total) => {
            showExportStatus(`正在读取逐词明细 ${done}/${total}…`);
        });

        const report = buildPrintReport({
            sessions, logs, words, rows,
            detailCount: detailed.length,
            budget: { left: PRINT_DETAIL_ROWS }
        });

        document.querySelectorAll('.print-report').forEach(node => node.remove());
        document.body.appendChild(report);

        // 打完（或取消）再放行页面，免得把界面一起打进去
        const cleanup = () => {
            document.body.classList.remove('print-report-open');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);

        document.body.classList.add('print-report-open');
        hideExportStatus();
        window.print();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.recordsPdf, false);
        hideExportStatus();
    }
}

/* ---------------- 离线字典 ---------------- */

// 音标来自内置的美音音标词典，中文释义来自内置的 ECDICT 裁剪词库，都完全离线
function renderDictResult() {
    const raw = els.dictInput.value.trim();

    els.dictResult.replaceChildren();
    els.dictResult.className = 'dict-result';

    if (!raw) {
        els.dictResult.textContent = '输入一个英文单词，这里会显示它的美音音标和中文释义。';
        return;
    }

    if (!phoneticsReady() || !dictReady()) {
        els.dictResult.textContent = '正在加载词典（约 6MB，只加载一次）…';
        Promise.all([
            phoneticsReady() ? null : loadPhonetics(),
            dictReady() ? null : loadDictionary()
        ])
            .then(renderDictResult)
            .catch(() => {
                els.dictResult.className = 'dict-result';
                els.dictResult.textContent = '词典加载失败，请检查网络后重试。';
            });
        return;
    }

    const ipa = phoneticOf(raw);
    const meaning = meaningOf(raw);

    if (!ipa && !meaning) {
        els.dictResult.textContent = `词典里没有收录「${raw}」。`;
        return;
    }

    const word = document.createElement('div');
    word.className = 'dict-word';
    word.textContent = raw;

    const row = document.createElement('div');
    row.className = 'dict-phonetic-row';

    if (ipa) {
        const phonetic = document.createElement('span');
        phonetic.className = 'dict-phonetic';
        phonetic.textContent = ipa;
        row.appendChild(phonetic);
    }
    row.appendChild(makeSpeakButton(raw));
    els.dictResult.append(word, row);

    if (!meaning) {
        const hint = document.createElement('div');
        hint.className = 'dict-note';
        hint.textContent = '这个词收在音标词典里，但不在中文词库范围内。';
        els.dictResult.appendChild(hint);
        return;
    }

    const box = document.createElement('div');
    box.className = 'dict-meaning';
    meaningLines(meaning).forEach(line => {
        const sense = document.createElement('div');
        sense.className = 'dict-sense';
        sense.textContent = line;
        box.appendChild(sense);
    });
    els.dictResult.appendChild(box);

    // 查到的词可以顺手加进单词本；释义压成一行存，列表里看着整齐
    const actions = document.createElement('div');
    actions.className = 'dict-actions';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-ghost';
    add.id = 'dictAddWord';
    add.textContent = '＋ 加入生词本';
    add.addEventListener('click', () => addDictWordToBook(add, raw, meaningLines(meaning).join('；')));
    actions.appendChild(add);

    // 查到的释义来自内置词典，不属于任何单词本，改不了，只能报错
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'btn-ghost';
    report.textContent = '⚠️ 报错';
    report.addEventListener('click', () => fixWord({
        word: null,
        bookId: null,
        term: raw,
        meaning: meaningLines(meaning).join('；'),
        source: 'dict'
    }));
    actions.appendChild(report);

    els.dictResult.appendChild(actions);
}

// 加入生词本：每次让用户挑一本
async function addDictWordToBook(button, term, meaning) {
    if (!wordsState.books.length) {
        toast('还没有单词本，先去「＋ 新建」建一个', 'info');
        return;
    }

    const bookId = await chooseDialog({
        title: `把「${term}」加到哪本单词本？`,
        options: wordsState.books.map(book => ({
            value: book.id,
            label: book.name,
            hint: `${book.wordCount} 个单词`
        }))
    });

    if (!bookId) return;

    const book = wordsState.books.find(item => item.id === bookId);
    setLoading(button, true);

    try {
        const result = await api.wordbooks.addWord(bookId, { term, meaning });

        if (result.duplicate) {
            toast(`「${term}」已经在《${book ? book.name : '这个单词本'}》里了`, 'info');
            return;
        }

        if (book) book.wordCount += 1;
        renderBooks();

        toast(result.pending
            ? `已记下，联网后会自动加入《${book ? book.name : '单词本'}》`
            : `已加入《${book ? book.name : '单词本'}》`, 'success');
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(button, false);
    }
}

function speakDictWord() {
    const word = els.dictInput.value.trim();
    if (!word) return;
    if (!speak(word)) toast('当前浏览器不支持语音朗读', 'error');
}

/* ---------------- 工具切换 ---------------- */

const TOOL_LABELS = { timer: '⏱ 计时器', countdown: '⏳ 倒计时', words: '📖 背单词', dict: '🔤 字典', vocab: '📊 词汇量测试' };

// 传 null 回到「只列功能」的首页；选中某个工具后只显示它自己
function switchTool(name) {
    const home = !name;

    els.toolHome.hidden = !home;
    els.toolBar.hidden = home;
    if (!home) els.toolBarTitle.textContent = TOOL_LABELS[name] || '';

    els.panelTimer.classList.toggle('hidden', name !== 'timer');
    els.panelCountdown.classList.toggle('hidden', name !== 'countdown');
    els.panelWords.classList.toggle('hidden', name !== 'words');
    els.panelDict.classList.toggle('hidden', name !== 'dict');
    els.panelVocab.classList.toggle('hidden', name !== 'vocab');

    // 词汇量测试的词库第一次进来才加载
    if (name === 'vocab') els.vocabTool.activate();

    if (name === 'dict') {
        // 切进来就先加载，第一次查词就不用等
        if (!phoneticsReady()) loadPhonetics().catch(() => {});
        if (!dictReady()) loadDictionary().catch(() => {});
        renderDictResult();
        els.dictInput.focus();
    }
}

/* ---------------- 上传文件 ---------------- */

function setUploadStatus(el, text, type = '') {
    if (!text) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.className = `upload-status${type ? ' ' + type : ''}`;
    el.textContent = text;
}

// 读取出来的文字追加到现有文本后面，而不是覆盖用户已经粘贴的内容
function appendToTextarea(textarea, text) {
    const current = textarea.value.replace(/\s+$/, '');
    textarea.value = current ? `${current}\n${text}` : text;
}

async function readUploadedFiles(files, { status, textarea, onDone }) {
    const parts = [];
    const notes = [];
    const multiple = files.length > 1;

    for (const file of files) {
        if (multiple) setUploadStatus(status, `正在读取 ${file.name}…`);

        try {
            const { text, note } = await extractFile(file, message => {
                setUploadStatus(status, `${file.name}：${message}`);
            });
            if (text && text.trim()) parts.push(text.trim());
            if (note) notes.push(`${file.name}：${note}`);
        } catch (err) {
            notes.push(`${file.name}：${err.message}`);
        }
    }

    if (parts.length) {
        appendToTextarea(textarea, parts.join('\n'));
        onDone();
        const summary = `已读取 ${parts.length} 个文件的内容`;
        setUploadStatus(status, notes.length ? `${summary}（${notes.join('；')}）` : summary, notes.length ? '' : 'ok');
    } else {
        onDone();
        setUploadStatus(status, notes.join('；') || '没有读取到内容', 'error');
    }
}

function setupUpload({ input, button, status, textarea, dropEls, onDone }) {
    input.accept = ACCEPT;

    let busy = false;
    async function run(files) {
        if (busy || !files.length) return;
        busy = true;
        setLoading(button, true);
        try {
            await readUploadedFiles(files, { status, textarea, onDone });
        } finally {
            setLoading(button, false);
            busy = false;
        }
    }

    button.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
        const files = [...input.files];
        input.value = '';
        run(files);
    });

    dropEls.forEach(el => {
        el.addEventListener('dragover', event => {
            event.preventDefault();
            el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', event => {
            event.preventDefault();
            el.classList.remove('drop-target');
            run([...((event.dataTransfer && event.dataTransfer.files) || [])]);
        });
    });
}

/* ---------------- 初始化 ---------------- */

function cacheElements() {
    els.toolHome = $('#toolHome');
    els.toolBar = $('#toolBar');
    els.toolBarTitle = $('#toolBarTitle');
    els.toolBack = $('#toolBack');
    els.panelTimer = $('#panel-timer');
    els.panelCountdown = $('#panel-countdown');
    els.panelWords = $('#panel-words');
    els.panelDict = $('#panel-dict');
    els.panelVocab = $('#panel-vocab');
    els.vocabTool = createVocabTool(els.panelVocab);

    els.dictInput = $('#dictInput');
    els.dictResult = $('#dictResult');

    els.timerDisplay = $('#timerDisplay');
    els.timerHint = $('#timerHint');
    els.timerToggle = $('#timerToggle');
    els.timerReset = $('#timerReset');
    els.timerLap = $('#timerLap');
    els.lapList = $('#lapList');

    els.countdownDisplay = $('#countdownDisplay');
    els.countdownHint = $('#countdownHint');
    els.countdownPresets = $('#countdownPresets');
    els.countdownMinutes = $('#countdownMinutes');
    els.countdownApply = $('#countdownApply');
    els.countdownToggle = $('#countdownToggle');
    els.countdownReset = $('#countdownReset');

    els.wordHome = $('#wordHome');
    els.wordImport = $('#wordImport');
    els.wordDetail = $('#wordDetail');
    els.wordRecords = $('#wordRecords');

    els.bookList = $('#bookList');
    els.bookEmpty = $('#bookEmpty');
    els.newBookBtn = $('#newBookBtn');

    els.recordsBtn = $('#recordsBtn');
    els.recordsBack = $('#recordsBack');
    els.recordsPdf = $('#recordsPdf');
    els.recordsCsv = $('#recordsCsv');
    els.recordsExportStatus = $('#recordsExportStatus');
    els.recordsToday = $('#recordsToday');
    els.recordsFilter = $('#recordsFilter');
    els.recordList = $('#recordList');
    els.recordsEmpty = $('#recordsEmpty');

    els.bookName = $('#bookName');
    els.bookText = $('#bookText');
    els.bookFile = $('#bookFile');
    els.bookFileBtn = $('#bookFileBtn');
    els.bookFileStatus = $('#bookFileStatus');
    els.importCount = $('#importCount');
    els.swapToggle = $('#swapToggle');
    els.importSortGroup = $('#importSortGroup');
    els.previewToggle = $('#previewToggle');
    els.wordPreview = $('#wordPreview');
    els.importSave = $('#importSave');
    els.importCancel = $('#importCancel');

    els.detailTitle = $('#detailTitle');
    els.detailBack = $('#detailBack');
    els.detailStats = $('#detailStats');
    els.detailTabs = $('#detailTabs');

    els.studyView = $('#studyView');
    els.studyProgress = $('#studyProgress');
    els.studyCard = $('#studyCard');
    els.studyTerm = $('#studyTerm');
    els.studyMeaning = $('#studyMeaning');
    els.studyTip = $('#studyTip');
    els.studyActions = $('#studyActions');
    els.studySummary = $('#studySummary');
    els.studyRestart = $('#studyRestart');
    els.studyShuffle = $('#studyShuffle');
    els.studyAutoSpeak = $('#studyAutoSpeak');
    els.studyPhonetic = $('#studyPhonetic');
    els.studySpeak = $('#studySpeak');
    els.studyReportRow = $('#studyReportRow');
    els.studyReport = $('#studyReport');

    els.quizView = $('#quizView');
    els.quizSetup = $('#quizSetup');
    els.quizSetupHint = $('#quizSetupHint');
    els.quizTypeGroup = $('#quizTypeGroup');
    els.quizDirGroup = $('#quizDirGroup');
    els.quizScopeGroup = $('#quizScopeGroup');
    els.quizScopeSelected = $('#quizScopeGroup button[data-scope="selected"]');
    els.quizSizeGroup = $('#quizSizeGroup');
    els.quizSizeInput = $('#quizSizeInput');
    els.quizLimitGroup = $('#quizLimitGroup');
    els.quizElapsed = $('#quizElapsed');
    els.quizCountdown = $('#quizCountdown');
    els.quizStart = $('#quizStart');
    els.quizRun = $('#quizRun');
    els.quizProgress = $('#quizProgress');
    els.quizPrompt = $('#quizPrompt');
    els.quizSub = $('#quizSub');
    els.quizOptions = $('#quizOptions');
    els.quizSpell = $('#quizSpell');
    els.quizInput = $('#quizInput');
    els.quizSubmit = $('#quizSubmit');
    els.quizFeedback = $('#quizFeedback');
    els.quizOverride = $('#quizOverride');
    els.quizNext = $('#quizNext');
    els.quizResult = $('#quizResult');

    els.wrongTab = $('#detailTabs button[data-view="wrong"]');
    els.wrongView = $('#wrongView');
    els.wrongSetup = $('#wrongSetup');
    els.wrongStats = $('#wrongStats');
    els.wrongHint = $('#wrongHint');
    els.elimTypeGroup = $('#elimTypeGroup');
    els.wrongStart = $('#wrongStart');
    els.wrongRun = $('#wrongRun');
    els.wrongProgress = $('#wrongProgress');
    els.wrongPrompt = $('#wrongPrompt');
    els.wrongSub = $('#wrongSub');
    els.wrongOptions = $('#wrongOptions');
    els.wrongSpell = $('#wrongSpell');
    els.wrongInput = $('#wrongInput');
    els.wrongSubmit = $('#wrongSubmit');
    els.wrongFeedback = $('#wrongFeedback');
    els.wrongOverride = $('#wrongOverride');
    els.wrongNext = $('#wrongNext');
    els.wrongQuit = $('#wrongQuit');
    els.wrongDone = $('#wrongDone');

    els.listView = $('#listView');
    els.wordList = $('#wordList');
    els.wordEmpty = $('#wordEmpty');
    els.wordFilter = $('#wordFilter');
    els.wordSortGroup = $('#wordSortGroup');
    els.wordSearch = $('#wordSearch');
    els.wordSearchNext = $('#wordSearchNext');
    els.wordSearchHint = $('#wordSearchHint');
    els.selectCount = $('#selectCount');
    els.selectAllBtn = $('#selectAllBtn');
    els.selectClearBtn = $('#selectClearBtn');
    els.quizSelectedBtn = $('#quizSelectedBtn');
    els.addWordsBtn = $('#addWordsBtn');
    els.resetProgressBtn = $('#resetProgressBtn');
    els.deleteBookBtn = $('#deleteBookBtn');

    els.wordPager = $('#wordPager');
    els.pageSizeGroup = $('#pageSizeGroup');
    els.pagePrev = $('#pagePrev');
    els.pageNext = $('#pageNext');
    els.pageInfo = $('#pageInfo');
    els.pageJump = $('#pageJump');

    els.addWordsView = $('#addWordsView');
    els.addText = $('#addText');
    els.addFile = $('#addFile');
    els.addFileBtn = $('#addFileBtn');
    els.addFileStatus = $('#addFileStatus');
    els.addCount = $('#addCount');
    els.addSortGroup = $('#addSortGroup');
    els.addPreviewToggle = $('#addPreviewToggle');
    els.addPreview = $('#addPreview');
    els.addSave = $('#addSave');
    els.addWordsCancel = $('#addWordsCancel');
}

function bindEvents() {
    els.toolHome.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tool]');
        if (btn) switchTool(btn.dataset.tool);
    });
    els.toolBack.addEventListener('click', () => switchTool(null));

    // 离线字典
    els.dictInput.addEventListener('input', renderDictResult);
    els.dictInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') speakDictWord();
    });

    // 计时器
    els.timerToggle.addEventListener('click', () => (timer.running ? pauseTimer() : startTimer()));
    els.timerReset.addEventListener('click', resetTimer);
    els.timerLap.addEventListener('click', addLap);

    // 倒计时
    els.countdownPresets.addEventListener('click', e => {
        const chip = e.target.closest('.preset-chip');
        if (!chip) return;
        $$('#countdownPresets .preset-chip').forEach(item => item.classList.toggle('active', item === chip));
        setCountdownTotal(Number(chip.dataset.minutes) * 60 * 1000);
    });
    els.countdownApply.addEventListener('click', applyCustomMinutes);
    els.countdownMinutes.addEventListener('keydown', e => {
        if (e.key === 'Enter') applyCustomMinutes();
    });
    els.countdownToggle.addEventListener('click', () => (countdown.running ? pauseCountdown() : startCountdown()));
    els.countdownReset.addEventListener('click', resetCountdown);

    // 新建 / 导入
    els.newBookBtn.addEventListener('click', openImport);
    els.importCancel.addEventListener('click', () => showWordView('home'));

    // 学习记录
    els.recordsBtn.addEventListener('click', openRecords);
    els.recordsBack.addEventListener('click', () => showWordView('home'));
    els.recordsPdf.addEventListener('click', exportLearningPdf);
    els.recordsCsv.addEventListener('click', exportWrongCsv);
    els.recordsFilter.addEventListener('click', e => {
        const btn = e.target.closest('button[data-kind]');
        if (!btn) return;
        recordsState.kind = btn.dataset.kind;
        $$('#recordsFilter button').forEach(item => item.classList.toggle('active', item === btn));
        renderRecordList();
    });
    els.bookText.addEventListener('input', refreshImport);
    setupUpload({
        input: els.bookFile,
        button: els.bookFileBtn,
        status: els.bookFileStatus,
        textarea: els.bookText,
        dropEls: [els.bookText, els.bookFileBtn],
        onDone: refreshImport
    });
    els.swapToggle.addEventListener('click', () => {
        wordsState.swap = !wordsState.swap;
        els.swapToggle.classList.toggle('active', wordsState.swap);
        refreshImport();
    });
    els.importSortGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-sort]');
        if (!btn) return;
        wordsState.importSort = btn.dataset.sort;
        syncSortSwitch(els.importSortGroup, wordsState.importSort);
        refreshImport();
    });
    els.previewToggle.addEventListener('click', () => {
        const show = els.wordPreview.hidden;
        els.wordPreview.hidden = !show;
        els.previewToggle.textContent = show ? '收起' : '预览';
        if (show) renderPreview(els.wordPreview, wordsState.parsed);
    });
    els.importSave.addEventListener('click', saveImport);

    // 详情
    els.detailBack.addEventListener('click', () => {
        showWordView('home');
        els.detailTitle.textContent = '单词本';
    });
    els.detailTabs.addEventListener('click', e => {
        const btn = e.target.closest('button[data-view]');
        if (btn) openDetailTab(btn.dataset.view);
    });

    // 背诵
    els.studyCard.addEventListener('click', revealStudy);
    els.studyCard.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            revealStudy();
        }
    });
    els.studyActions.addEventListener('click', e => {
        const btn = e.target.closest('button[data-mark]');
        if (btn) markStudy(btn.dataset.mark);
    });
    els.studyRestart.addEventListener('click', startStudy);
    els.studyShuffle.addEventListener('change', startStudy);

    els.studySpeak.addEventListener('click', event => {
        event.stopPropagation();
        const word = currentStudyWord();
        if (word && !speak(word.term)) toast('当前浏览器不支持语音朗读', 'error');
    });
    // 不拦下来的话，Enter / 空格会冒泡到卡片，被当成「翻开释义」
    els.studySpeak.addEventListener('keydown', event => event.stopPropagation());

    els.studyAutoSpeak.addEventListener('change', () => {
        if (!els.studyAutoSpeak.checked) return;
        const word = currentStudyWord();
        if (word) speak(word.term);
    });

    els.studyReport.addEventListener('click', () => {
        const word = currentStudyWord();
        if (!word) return;
        fixWord({
            word,
            term: word.term,
            meaning: word.meaning,
            source: 'study',
            refresh: refreshStudyCard
        });
    });

    // 考核
    els.quizTypeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-type]');
        if (!btn) return;
        quiz.type = btn.dataset.type;
        $$('#quizTypeGroup button').forEach(item => item.classList.toggle('active', item === btn));
        // 只有选择题有「方向」（看词选义 / 看义选词）
        els.quizDirGroup.closest('.setting-row').hidden = quiz.type !== 'choice';
        updateQuizHint();
    });
    els.quizDirGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-dir]');
        if (!btn) return;
        quiz.dir = btn.dataset.dir;
        $$('#quizDirGroup button').forEach(item => item.classList.toggle('active', item === btn));
    });
    els.quizScopeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-scope]');
        if (!btn || btn.hidden) return;
        quiz.scope = btn.dataset.scope;
        if (quiz.scope !== 'selected') quiz.override = null;
        // 「考核选中」自动填的题量，取消选中时一并清掉，免得给新范围留一个隐形上限
        if (quiz.customFromSelection && quiz.scope !== 'selected') {
            quiz.customFromSelection = false;
            quiz.customSize = 0;
            els.quizSizeInput.value = '';
        }
        syncQuizScope();
        syncQuizSize();
        updateQuizHint();
    });
    els.quizSizeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-size]');
        if (!btn) return;
        quiz.size = Number(btn.dataset.size);
        quiz.customSize = 0;
        quiz.customFromSelection = false;
        els.quizSizeInput.value = '';
        syncQuizSize();
        updateQuizHint();
    });
    els.quizSizeInput.addEventListener('input', () => {
        const value = Math.floor(Number(els.quizSizeInput.value));
        quiz.customSize = value > 0 ? value : 0;
        quiz.customFromSelection = false;
        syncQuizSize();
        updateQuizHint();
    });
    els.quizLimitGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-limit]');
        if (!btn) return;
        quiz.limitSeconds = Number(btn.dataset.limit) || 0;
        saveQuizLimit(quiz.limitSeconds);
        syncQuizLimit();
        updateQuizHint();
    });
    els.quizStart.addEventListener('click', startQuiz);
    els.quizSubmit.addEventListener('click', submitTyped);
    els.quizInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitTyped();
    });
    els.quizOverride.addEventListener('click', acceptQuizMeaning);
    els.quizNext.addEventListener('click', nextQuestion);

    // 消灭错词
    els.elimTypeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-type]');
        if (!btn) return;
        elim.type = btn.dataset.type;
        syncElimType();
        refreshWrongStats();
    });
    els.wrongStart.addEventListener('click', startElim);
    els.wrongSubmit.addEventListener('click', submitElimTyped);
    els.wrongInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitElimTyped();
    });
    els.wrongOverride.addEventListener('click', acceptElimOverride);
    els.wrongNext.addEventListener('click', nextElim);
    els.wrongQuit.addEventListener('click', finishElim);

    // 单词列表：状态筛选与勾选
    els.wordFilter.addEventListener('click', e => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        wordsState.filter = btn.dataset.filter;
        wordsState.page = 1;
        refreshWordList();
    });
    // 排序切换会记住选择
    els.wordSortGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-sort]');
        if (!btn) return;
        wordsState.listSort = btn.dataset.sort;
        saveListSort(wordsState.listSort);
        syncSortSwitch(els.wordSortGroup, wordsState.listSort);
        wordsState.page = 1;
        refreshWordList();
    });
    // 分页：每页条数同样记住
    els.pageSizeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-size]');
        if (!btn) return;
        wordsState.pageSize = Number(btn.dataset.size);
        savePageSize(wordsState.pageSize);
        wordsState.page = 1;
        refreshWordList();
    });

    // 搜单词：停顿一下再定位，免得边打字边跳页；回车直接看下一个
    let searchTimer = null;
    els.wordSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 250);
    });
    els.wordSearch.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        clearTimeout(searchTimer);
        if (els.wordSearch.value === wordSearch.query) stepSearch(1);
        else runSearch();
    });
    els.wordSearchNext.addEventListener('click', () => stepSearch(1));
    els.pagePrev.addEventListener('click', () => goToPage(wordsState.page - 1));
    els.pageNext.addEventListener('click', () => goToPage(wordsState.page + 1));

    // 页码输入框：停顿一下或回车就自动跳，避免边打字边跳
    let pageJumpTimer = null;
    els.pageJump.addEventListener('input', () => {
        clearTimeout(pageJumpTimer);
        pageJumpTimer = setTimeout(jumpToTypedPage, 400);
    });
    els.pageJump.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        clearTimeout(pageJumpTimer);
        jumpToTypedPage();
    });
    els.pageJump.addEventListener('blur', () => {
        clearTimeout(pageJumpTimer);
        const typed = Math.floor(Number(els.pageJump.value));
        if (Number.isFinite(typed) && typed >= 1 && typed !== wordsState.page) jumpToTypedPage();
        else els.pageJump.value = String(wordsState.page);
    });
    els.selectAllBtn.addEventListener('click', selectCurrentPage);
    els.selectClearBtn.addEventListener('click', clearSelection);
    els.quizSelectedBtn.addEventListener('click', quizSelected);

    // 单词列表
    els.addWordsBtn.addEventListener('click', openAddWords);
    els.resetProgressBtn.addEventListener('click', resetProgress);
    els.deleteBookBtn.addEventListener('click', () => {
        if (wordsState.current) removeBook(wordsState.current);
    });

    // 追加单词
    els.addWordsCancel.addEventListener('click', () => openDetailTab('list'));
    els.addText.addEventListener('input', refreshAdd);
    setupUpload({
        input: els.addFile,
        button: els.addFileBtn,
        status: els.addFileStatus,
        textarea: els.addText,
        dropEls: [els.addText, els.addFileBtn],
        onDone: refreshAdd
    });
    els.addSortGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-sort]');
        if (!btn) return;
        wordsState.addSort = btn.dataset.sort;
        syncSortSwitch(els.addSortGroup, wordsState.addSort);
        refreshAdd();
    });
    els.addPreviewToggle.addEventListener('click', () => {
        const show = els.addPreview.hidden;
        els.addPreview.hidden = !show;
        els.addPreviewToggle.textContent = show ? '收起' : '预览';
        if (show) renderPreview(els.addPreview, wordsState.addParsed);
    });
    els.addSave.addEventListener('click', saveAddWords);
}

// 在线时把还没缓存过的内容在后台存一份，这样之后切到离线模式能直接用
// （离线缓存只由「在线成功读过」的内容填充；已经有缓存的不重复请求）
async function warmUpOfflineCache() {
    for (const book of wordsState.books) {
        if (net.isOffline()) return;
        if (net.cacheValue(`book:${book.id}`) !== undefined) continue;

        try {
            await api.wordbooks.detail(book.id);
        } catch {
            // 预热失败不影响当前使用，下次在线打开工具页会再试
        }
    }

    if (net.isOffline() || net.cacheValue('records') !== undefined) return;

    try {
        await api.wordbooks.records(200);
    } catch {
        /* 同上 */
    }
}

async function init() {
    cacheElements();
    bindEvents();
    renderTimer();
    renderCountdown();
    warmUpVoices();

    try {
        wordsState.books = await api.wordbooks.list();
        renderBooks();
        if (!net.isOffline()) warmUpOfflineCache();
    } catch (err) {
        // 列表区直接把原因写出来：离线且没缓存过时只弹 toast，用户会以为单词本丢了
        els.bookEmpty.hidden = false;
        els.bookEmpty.textContent = err.message;
        toast(err.message, 'error');
    }
}

if (initShell({ active: 'tools' })) init();
