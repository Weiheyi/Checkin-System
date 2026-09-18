import { api } from './api.js';
import { $, $$, toast, confirmDialog, setLoading } from './ui.js';
import { initShell } from './shell.js';
import { extractFile, ACCEPT } from './file-extract.js';

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

// 整段文本 → 去重后的单词数组；swap 用于中英顺序颠倒的单词表
function parseWordList(text, { swap = false } = {}) {
    const seen = new Set();
    const list = [];

    String(text || '').split(/\r?\n/).forEach(raw => {
        const parsed = parseLine(raw);
        if (!parsed) return;

        let { term, meaning } = parsed;
        if (swap) [term, meaning] = [meaning, term];

        const key = term.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        list.push({ term, meaning });
    });

    return list;
}

/* ---------------- 单词本 ---------------- */

const wordsState = {
    books: [],
    current: null,
    words: [],
    parsed: [],
    addParsed: [],
    swap: false
};

const study = { queue: [], index: 0, revealed: false, result: { known: 0, vague: 0, again: 0 } };

const quiz = {
    type: 'choice',
    dir: 'term',
    size: 10,
    questions: [],
    index: 0,
    correct: 0,
    wrong: [],
    answered: false
};

function masteryLabel(mastery) {
    if (mastery >= 5) return '已掌握';
    if (mastery >= 3) return '熟悉';
    if (mastery >= 1) return '学习中';
    return '新词';
}

function showWordView(view) {
    els.wordHome.hidden = view !== 'home';
    els.wordImport.hidden = view !== 'import';
    els.wordDetail.hidden = view !== 'detail';
}

function renderBooks() {
    const books = wordsState.books;
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
    const mastered = words.filter(w => w.mastery >= 3).length;
    const correct = words.reduce((sum, w) => sum + w.correct_count, 0);
    const wrong = words.reduce((sum, w) => sum + w.wrong_count, 0);
    const rate = correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
    return { total, mastered, rate };
}

function renderDetailStats() {
    const stats = computeStats(wordsState.words);
    els.detailStats.replaceChildren(statItem('📚', stats.total, '单词总数'), statItem('✅', stats.mastered, '已掌握'), statItem('🎯', `${stats.rate}%`, '正确率'));
}

function statItem(icon, value, label) {
    const wrap = document.createElement('div');
    wrap.className = 'stat-item';

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
    els.bookName.value = '';
    els.bookText.value = '';
    els.importCount.textContent = '识别到 0 个单词';
    els.importSave.disabled = true;
    els.swapToggle.classList.remove('active');
    els.wordPreview.hidden = true;
    els.wordPreview.replaceChildren();
    els.previewToggle.textContent = '预览';
    showWordView('import');
    els.bookName.focus();
}

function refreshImport() {
    wordsState.parsed = parseWordList(els.bookText.value, { swap: wordsState.swap });
    els.importCount.textContent = `识别到 ${wordsState.parsed.length} 个单词`;
    els.importSave.disabled = wordsState.parsed.length === 0;
    if (!els.wordPreview.hidden) renderPreview(els.wordPreview, wordsState.parsed);
}

async function saveImport() {
    const words = wordsState.parsed;
    if (!words.length) return toast('还没有识别到单词', 'error');

    const name = els.bookName.value.trim() || '未命名单词本';
    setLoading(els.importSave, true);
    try {
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
        els.detailTitle.textContent = book.name;
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
    els.addWordsView.hidden = view !== 'add';
    $$('#detailTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

    if (view === 'study') startStudy();
    else if (view === 'quiz') resetQuizSetup();
    else if (view === 'list') renderWordList();
}

function renderWordList() {
    const words = wordsState.words;
    els.wordEmpty.hidden = words.length > 0;
    els.wordList.replaceChildren();

    const fragment = document.createDocumentFragment();
    words.forEach(word => {
        const li = document.createElement('li');
        li.className = 'word-item';

        const main = document.createElement('div');
        main.className = 'word-main';

        const term = document.createElement('div');
        term.className = 'word-term';
        term.textContent = word.term;

        const meaning = document.createElement('div');
        meaning.className = 'word-meaning';
        meaning.textContent = word.meaning || '—';

        main.append(term, meaning);

        const meta = document.createElement('div');
        meta.className = 'word-meta';

        const badge = document.createElement('span');
        badge.className = `mastery-badge m${Math.min(5, word.mastery)}`;
        badge.textContent = masteryLabel(word.mastery);
        meta.appendChild(badge);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-btn word-delete';
        del.textContent = '删除';
        del.setAttribute('aria-label', `删除单词 ${word.term}`);
        del.addEventListener('click', () => removeWord(word));

        li.append(main, meta, del);
        fragment.appendChild(li);
    });

    els.wordList.appendChild(fragment);
}

async function removeWord(word) {
    try {
        await api.wordbooks.removeWord(word.id);
        wordsState.words = wordsState.words.filter(item => item.id !== word.id);
        wordsState.current.wordCount = wordsState.words.length;
        renderWordList();
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
    els.addText.value = '';
    els.addCount.textContent = '识别到 0 个单词';
    els.addSave.disabled = true;
    els.addPreview.hidden = true;
    els.addPreview.replaceChildren();
    els.addPreviewToggle.textContent = '预览';
    openDetailTab('add');
    els.addText.focus();
}

function refreshAdd() {
    wordsState.addParsed = parseWordList(els.addText.value, { swap: false });
    els.addCount.textContent = `识别到 ${wordsState.addParsed.length} 个单词`;
    els.addSave.disabled = wordsState.addParsed.length === 0;
    if (!els.addPreview.hidden) renderPreview(els.addPreview, wordsState.addParsed);
}

async function saveAddWords() {
    const words = wordsState.addParsed;
    if (!words.length) return toast('还没有识别到单词', 'error');

    setLoading(els.addSave, true);
    try {
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

/* ---------------- 背诵 ---------------- */

function startStudy() {
    const words = wordsState.words;
    if (!words.length) {
        els.studyProgress.textContent = '';
        els.studyCard.hidden = true;
        els.studyActions.hidden = true;
        els.studySummary.hidden = false;
        renderSummary(els.studySummary, [], '这个本子还没有单词');
        return;
    }

    study.queue = words.slice();
    if (els.studyShuffle.checked) shuffle(study.queue);
    study.index = 0;
    study.revealed = false;
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
    els.studyProgress.textContent = `${study.index + 1} / ${study.queue.length}`;
    els.studyCard.classList.remove('revealed');
}

function revealStudy() {
    if (study.revealed || els.studyCard.hidden) return;
    study.revealed = true;
    els.studyMeaning.hidden = false;
    els.studyTip.hidden = true;
    els.studyActions.hidden = false;
    els.studyCard.classList.add('revealed');
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
    saveWord(word);

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
    els.studyProgress.textContent = total ? `${total} / ${total}` : '';
    els.studySummary.hidden = false;
    renderSummary(els.studySummary, [
        ['认识', result.known],
        ['模糊', result.vague],
        ['不认识', result.again]
    ], `本轮完成，共 ${total} 个单词`);
    renderDetailStats();
}

/* ---------------- 考核 ---------------- */

function resetQuizSetup() {
    els.quizSetup.hidden = false;
    els.quizRun.hidden = true;
    els.quizResult.hidden = true;
    updateQuizHint();
}

function updateQuizHint() {
    const usable = wordsState.words.filter(w => w.term && w.meaning).length;
    const notes = [`共 ${wordsState.words.length} 个单词，其中 ${usable} 个有释义可参与考核。`];
    if (!usable) notes.push('请先在「单词」里补充释义。');
    else if (quiz.type === 'choice' && usable < 4) notes.push('选择题需要至少 4 个带释义的单词才能凑齐选项，建议改用拼写。');
    els.quizSetupHint.textContent = notes.join(' ');
}

function buildQuizQuestions() {
    const usable = wordsState.words.filter(w => w.term && w.meaning);
    if (!usable.length) return [];

    const pool = shuffle(usable.slice());
    const limit = quiz.size > 0 ? Math.min(quiz.size, pool.length) : pool.length;

    return pool.slice(0, limit).map(word => {
        if (quiz.type === 'spell') {
            return { word, kind: 'spell', prompt: word.meaning, sub: '根据释义拼写单词', answer: word.term };
        }

        const byTerm = quiz.dir === 'term';
        const answer = byTerm ? word.meaning : word.term;
        const field = byTerm ? 'meaning' : 'term';
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
    });
}

function startQuiz() {
    const questions = buildQuizQuestions();
    if (!questions.length) return toast('还没有可用于考核的单词，请先补充释义', 'error');

    quiz.questions = questions;
    quiz.index = 0;
    quiz.correct = 0;
    quiz.wrong = [];
    quiz.answered = false;

    els.quizSetup.hidden = true;
    els.quizResult.hidden = true;
    els.quizRun.hidden = false;
    renderQuizQuestion();
}

function renderQuizProgress() {
    els.quizProgress.textContent = `第 ${quiz.index + 1} / ${quiz.questions.length} 题 · 答对 ${quiz.correct}`;
}

function renderQuizQuestion() {
    const question = quiz.questions[quiz.index];
    if (!question) return finishQuiz();

    quiz.answered = false;
    renderQuizProgress();
    els.quizPrompt.textContent = question.prompt;
    els.quizSub.textContent = question.sub;
    els.quizFeedback.hidden = true;
    els.quizNext.hidden = true;
    els.quizOptions.replaceChildren();

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

function submitSpell() {
    const question = quiz.questions[quiz.index];
    if (!question || question.kind !== 'spell' || quiz.answered) return;

    const value = els.quizInput.value.trim();
    if (!value) return toast('请输入答案', 'error');

    quiz.answered = true;
    els.quizInput.disabled = true;
    els.quizSubmit.disabled = true;

    const ok = value.toLowerCase() === question.answer.trim().toLowerCase();
    resolveQuizAnswer(question, ok, value);
}

function resolveQuizAnswer(question, correct, given) {
    applyQuizResult(question.word, correct);

    if (correct) {
        quiz.correct += 1;
    } else {
        quiz.wrong.push({ prompt: question.prompt, answer: question.answer, given });
    }

    els.quizFeedback.hidden = false;
    els.quizFeedback.className = `quiz-feedback ${correct ? 'ok' : 'no'}`;
    els.quizFeedback.textContent = correct ? '答对了！' : `答错了，正确答案：${question.answer}`;
    renderQuizProgress();

    els.quizNext.hidden = false;
    els.quizNext.textContent = quiz.index + 1 >= quiz.questions.length ? '查看结果' : '下一题';
    els.quizNext.focus();
}

function nextQuestion() {
    if (!quiz.answered) return;
    quiz.index += 1;
    if (quiz.index >= quiz.questions.length) finishQuiz();
    else renderQuizQuestion();
}

function finishQuiz() {
    const total = quiz.questions.length;
    const rate = total ? Math.round((quiz.correct / total) * 100) : 0;

    els.quizRun.hidden = true;
    els.quizResult.hidden = false;
    renderSummary(els.quizResult, [
        ['答对', quiz.correct],
        ['答错', quiz.wrong.length],
        ['正确率', `${rate}%`]
    ], `考核完成，得分 ${rate} 分`);

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

/* ---------------- 共用 ---------------- */

function saveWord(word) {
    // 进度非关键路径：不 await，失败也不打断背诵/答题节奏
    api.wordbooks.saveProgress(word.id, {
        mastery: word.mastery,
        review_count: word.review_count,
        correct_count: word.correct_count,
        wrong_count: word.wrong_count
    }).catch(() => {});
}

function applyQuizResult(word, correct) {
    word.review_count += 1;
    if (correct) {
        word.correct_count += 1;
        word.mastery = Math.min(5, word.mastery + 1);
    } else {
        word.wrong_count += 1;
        word.mastery = 0;
    }
    saveWord(word);
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

/* ---------------- 工具切换 ---------------- */

function switchTool(name) {
    $$('#toolTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === name));
    els.panelTimer.classList.toggle('hidden', name !== 'timer');
    els.panelCountdown.classList.toggle('hidden', name !== 'countdown');
    els.panelWords.classList.toggle('hidden', name !== 'words');
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
    els.toolTabs = $('#toolTabs');
    els.panelTimer = $('#panel-timer');
    els.panelCountdown = $('#panel-countdown');
    els.panelWords = $('#panel-words');

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

    els.bookList = $('#bookList');
    els.bookEmpty = $('#bookEmpty');
    els.newBookBtn = $('#newBookBtn');

    els.bookName = $('#bookName');
    els.bookText = $('#bookText');
    els.bookFile = $('#bookFile');
    els.bookFileBtn = $('#bookFileBtn');
    els.bookFileStatus = $('#bookFileStatus');
    els.importCount = $('#importCount');
    els.swapToggle = $('#swapToggle');
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

    els.quizView = $('#quizView');
    els.quizSetup = $('#quizSetup');
    els.quizSetupHint = $('#quizSetupHint');
    els.quizTypeGroup = $('#quizTypeGroup');
    els.quizDirGroup = $('#quizDirGroup');
    els.quizSizeGroup = $('#quizSizeGroup');
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
    els.quizNext = $('#quizNext');
    els.quizResult = $('#quizResult');

    els.listView = $('#listView');
    els.wordList = $('#wordList');
    els.wordEmpty = $('#wordEmpty');
    els.addWordsBtn = $('#addWordsBtn');
    els.resetProgressBtn = $('#resetProgressBtn');
    els.deleteBookBtn = $('#deleteBookBtn');

    els.addWordsView = $('#addWordsView');
    els.addText = $('#addText');
    els.addFile = $('#addFile');
    els.addFileBtn = $('#addFileBtn');
    els.addFileStatus = $('#addFileStatus');
    els.addCount = $('#addCount');
    els.addPreviewToggle = $('#addPreviewToggle');
    els.addPreview = $('#addPreview');
    els.addSave = $('#addSave');
    els.addWordsCancel = $('#addWordsCancel');
}

function bindEvents() {
    els.toolTabs.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tool]');
        if (btn) switchTool(btn.dataset.tool);
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

    // 考核
    els.quizTypeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-type]');
        if (!btn) return;
        quiz.type = btn.dataset.type;
        $$('#quizTypeGroup button').forEach(item => item.classList.toggle('active', item === btn));
        els.quizDirGroup.closest('.setting-row').hidden = quiz.type === 'spell';
        updateQuizHint();
    });
    els.quizDirGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-dir]');
        if (!btn) return;
        quiz.dir = btn.dataset.dir;
        $$('#quizDirGroup button').forEach(item => item.classList.toggle('active', item === btn));
    });
    els.quizSizeGroup.addEventListener('click', e => {
        const btn = e.target.closest('button[data-size]');
        if (!btn) return;
        quiz.size = Number(btn.dataset.size);
        $$('#quizSizeGroup button').forEach(item => item.classList.toggle('active', item === btn));
    });
    els.quizStart.addEventListener('click', startQuiz);
    els.quizSubmit.addEventListener('click', submitSpell);
    els.quizInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitSpell();
    });
    els.quizNext.addEventListener('click', nextQuestion);

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
    els.addPreviewToggle.addEventListener('click', () => {
        const show = els.addPreview.hidden;
        els.addPreview.hidden = !show;
        els.addPreviewToggle.textContent = show ? '收起' : '预览';
        if (show) renderPreview(els.addPreview, wordsState.addParsed);
    });
    els.addSave.addEventListener('click', saveAddWords);
}

async function init() {
    cacheElements();
    bindEvents();
    renderTimer();
    renderCountdown();

    try {
        wordsState.books = await api.wordbooks.list();
        renderBooks();
    } catch (err) {
        toast(err.message, 'error');
    }
}

if (initShell({ active: 'tools' })) init();
