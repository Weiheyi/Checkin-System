// 错题本（工具页第 6 个工具）
//
// 流程：上传题目截图 -> OCR 预填 -> 手动校对 -> 存云端。
// 一本错题本可装多套卷，详情页按「卷」分组；题型是用户自定义标签（可增删改）。
//
// OCR 用英文识别包（public/vendor/tesseract-lang/eng.traineddata）；
// 截图识别不可能百分百准，所以定位是「预填 + 手动校对」，字段都能改。

import { api } from './api.js';
import { MISTAKE_DEFAULT_CATEGORIES } from './config.js';
import { store } from './store.js';
import { toast, confirmDialog, setLoading, skeletonRows } from './ui.js';
import { ocrImage } from './file-extract.js';
import * as net from './net.js';

const OCR_LANG = 'eng';
const OPTION_LABELS = ['A', 'B', 'C', 'D'];
const SEED_KEY_PREFIX = 'checkin_mistake_seeded_';

/* ---------------- OCR 文本解析 ---------------- */

// 卷名：优先「2026年9月国际B卷」这类，其次「第3套」
const PAPER_MONTH = /\d{4}\s*年\s*\d{1,2}\s*月[^\d\n]{0,14}?卷/;
const PAPER_SET = /第\s*\d{1,3}\s*[套卷]/;
// 题号：行首的「2.」「2、」「(2)」，后面要跟内容
const NUMBER_RE = /(?:^|\n)\s*(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.、)）]\s+\S/;
// 选项：(A) xxx / A. xxx / A、xxx
const OPTION_RE = /^\s*[（(]?\s*([A-Da-d])\s*[)）.、:：]\s*(.+)$/;
// 页眉特征：出现日期、年级、文法等，且带数字，才当页眉剔除
const HEADER_HINT = /(\d{4}\s*[-/年]\s*\d{1,2}|阅读文法|文法|高[一二三]年级|SAT\s*练习)/;

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

// 收集 A–D 选项，并记下第一个选项行所在的行号（题干在它之前）
function parseOptions(text) {
    const lines = String(text || '').split(/\r?\n/);
    const options = [];
    let firstOptionLine = -1;

    lines.forEach((line, index) => {
        const m = line.match(OPTION_RE);
        if (!m) return;

        const label = m[1].toUpperCase();
        const value = m[2].trim();
        if (!value || options.some(item => item.label === label)) return;

        options.push({ label, text: value });
        if (firstOptionLine < 0) firstOptionLine = index;
    });

    return { options, firstOptionLine };
}

// 题干：第一个选项行之前的文本，去掉明显的页眉行与行首题号
function cleanStem(lines, paper) {
    const kept = lines.filter(raw => {
        const line = raw.trim();
        if (!line) return false;
        if (/^\d{1,4}$/.test(line)) return false;                       // 孤立的页码 / 题号行
        if (paper && line.replace(/\s+/g, '').includes(paper)) return false;
        if (HEADER_HINT.test(line) && /\d/.test(line)) return false;
        return true;
    });

    return kept
        .join('\n')
        .replace(/^\s*(?:第\s*)?\d{1,3}\s*(?:题)?\s*[.、)）]\s*/, '')
        .trim();
}

// 整段 OCR 文本 -> 表单字段（paper / number / stem / options）
function parseQuestionText(raw) {
    const text = String(raw || '');
    const paper = detectPaper(text);
    const number = detectNumber(text);
    const { options, firstOptionLine } = parseOptions(text);

    const lines = text.split(/\r?\n/);
    const head = firstOptionLine < 0 ? lines : lines.slice(0, firstOptionLine);

    return { paper, number, stem: cleanStem(head, paper), options };
}

/* ---------------- 小工具 ---------------- */

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

// 一个带输入框的弹窗（重命名错题本 / 题型用），复用 ui.js 的弹窗样式
function textPrompt({ title = '输入', value = '', placeholder = '', confirmText = '确定' } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        const heading = document.createElement('h4');
        heading.className = 'modal-title';
        heading.textContent = title;

        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'text-input';
        field.value = value;
        field.placeholder = placeholder;

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-ghost';
        cancel.textContent = '取消';

        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn-primary';
        ok.textContent = confirmText;

        actions.append(cancel, ok);
        box.append(heading, field, actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close(result) {
            overlay.classList.remove('show');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 180);
            resolve(result);
        }

        function submit() {
            const text = field.value.trim();
            if (!text) return toast('不能为空', 'error');
            close(text);
        }

        function onKey(e) {
            if (e.key === 'Escape') close(null);
            else if (e.key === 'Enter') submit();
        }

        cancel.addEventListener('click', () => close(null));
        ok.addEventListener('click', submit);
        overlay.addEventListener('click', e => {
            if (e.target === overlay) close(null);
        });
        document.addEventListener('keydown', onKey);

        requestAnimationFrame(() => overlay.classList.add('show'));
        field.focus();
        field.select();
    });
}

/* ---------------- 工具本体 ---------------- */

// panel 是 <section id="panel-mistakes">，内部结构见 tools.html
export function createMistakesTool(panel) {
    if (!panel) return { activate() {} };

    const p$ = selector => panel.querySelector(selector);

    const els = {
        home: p$('#mkHome'),
        bookList: p$('#mkBookList'),
        bookEmpty: p$('#mkBookEmpty'),
        newBookBtn: p$('#mkNewBookBtn'),
        categoriesBtn: p$('#mkCategoriesBtn'),

        book: p$('#mkBook'),
        bookTitle: p$('#mkBookTitle'),
        bookBack: p$('#mkBookBack'),
        importBtn: p$('#mkImportBtn'),
        stats: p$('#mkStats'),
        categoryFilter: p$('#mkCategoryFilter'),
        paperFilter: p$('#mkPaperFilter'),
        questionList: p$('#mkQuestionList'),
        questionEmpty: p$('#mkQuestionEmpty'),

        form: p$('#mkForm'),
        formTitle: p$('#mkFormTitle'),
        formCancel: p$('#mkFormCancel'),
        screenshot: p$('#mkScreenshot'),
        screenshotBtn: p$('#mkScreenshotBtn'),
        screenshotStatus: p$('#mkScreenshotStatus'),
        shotPreview: p$('#mkShotPreview'),
        paper: p$('#mkPaper'),
        paperOptions: p$('#mkPaperOptions'),
        number: p$('#mkNumber'),
        category: p$('#mkCategory'),
        addCategoryBtn: p$('#mkAddCategoryBtn'),
        categoryInline: p$('#mkCategoryInline'),
        categoryInlineInput: p$('#mkCategoryInlineInput'),
        categoryInlineOk: p$('#mkCategoryInlineOk'),
        categoryInlineCancel: p$('#mkCategoryInlineCancel'),
        stem: p$('#mkStem'),
        options: p$('#mkOptions'),
        answer: p$('#mkAnswer'),
        myAnswer: p$('#mkMyAnswer'),
        analysis: p$('#mkAnalysis'),
        save: p$('#mkSave'),
        saveNext: p$('#mkSaveNext'),

        categories: p$('#mkCategories'),
        categoriesBack: p$('#mkCategoriesBack'),
        newCategory: p$('#mkNewCategory'),
        addCategory: p$('#mkAddCategory'),
        categoryList: p$('#mkCategoryList'),
        categoryEmpty: p$('#mkCategoryEmpty')
    };

    const state = {
        view: 'home',
        books: [],
        categories: [],
        currentBook: null,
        questions: [],
        papers: [],
        filterCategory: 'all',
        filterPaper: 'all',
        editing: null,
        shot: '',        // 当前表单待保存的截图 URL（空表示没有）
        seeded: false
    };

    // 选项输入框：A–D 固定四行
    const optionInputs = {};

    /* ---- 视图切换 ---- */

    function showView(view) {
        state.view = view;
        els.home.hidden = view !== 'home';
        els.book.hidden = view !== 'book';
        els.form.hidden = view !== 'form';
        els.categories.hidden = view !== 'categories';
    }

    function setStatus(el, text, type = '') {
        if (!text) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        el.hidden = false;
        el.className = `upload-status${type ? ' ' + type : ''}`;
        el.textContent = text;
    }

    /* ---- 进入 ---- */

    async function activate() {
        showView('home');
        els.bookList.replaceChildren(skeletonRows(2));
        els.bookEmpty.hidden = true;

        try {
            state.books = await api.mistakeBooks.list();
            state.categories = await api.mistakeCategories.list();
            await ensureSeeded();
            renderBooks();
        } catch (err) {
            els.bookList.replaceChildren();
            els.bookEmpty.hidden = false;
            els.bookEmpty.textContent = err.message;
            toast(err.message, 'error');
        }
    }

    // 首次使用：把默认题型拷进用户自己的题型表（只在没播种过时做一次）
    async function ensureSeeded() {
        if (state.categories.length || state.seeded || net.isOffline()) return;

        const uid = (store.getUser() || {}).id || 'anon';
        const key = SEED_KEY_PREFIX + uid;
        try {
            if (localStorage.getItem(key) === '1') return;
        } catch {
            /* 隐私模式下读不了，继续播种即可 */
        }

        for (let i = 0; i < MISTAKE_DEFAULT_CATEGORIES.length; i++) {
            try {
                const { category } = await api.mistakeCategories.create({
                    name: MISTAKE_DEFAULT_CATEGORIES[i],
                    sort: i
                });
                state.categories.push(category);
            } catch {
                // 单个失败不阻断整体播种（例如已有同名）
            }
        }

        state.seeded = true;
        try {
            localStorage.setItem(key, '1');
        } catch {
            /* 写不了就下次再来一遍，唯一约束保证不会重复 */
        }
    }

    /* ---- 错题本列表 ---- */

    function renderBooks() {
        els.bookEmpty.textContent = '还没有错题本，点「＋ 新建错题本」开始整理错题';
        els.bookEmpty.hidden = state.books.length > 0;
        els.bookList.replaceChildren();

        const fragment = document.createDocumentFragment();
        state.books.forEach(book => {
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
            sub.textContent = `${book.questionCount} 道错题`;

            main.append(name, sub);
            main.addEventListener('click', () => openBook(book));

            const rename = document.createElement('button');
            rename.type = 'button';
            rename.className = 'report-btn';
            rename.textContent = '改名';
            rename.addEventListener('click', () => renameBook(book));

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'delete-btn';
            del.textContent = '删除';
            del.setAttribute('aria-label', `删除错题本 ${book.name}`);
            del.addEventListener('click', () => removeBook(book));

            row.append(main, rename, del);
            fragment.appendChild(row);
        });

        els.bookList.appendChild(fragment);
    }

    async function createBook() {
        const name = await textPrompt({ title: '新建错题本', placeholder: '如 SAT 错题（九月）', confirmText: '创建' });
        if (!name) return;

        try {
            const { book } = await api.mistakeBooks.create({ name });
            state.books.unshift(book);
            renderBooks();
            toast(`已创建「${book.name}」`, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async function renameBook(book) {
        const name = await textPrompt({ title: '重命名错题本', value: book.name, confirmText: '保存' });
        if (!name || name === book.name) return;

        try {
            await api.mistakeBooks.rename(book.id, name);
            book.name = name;
            renderBooks();
            if (state.currentBook && state.currentBook.id === book.id) {
                state.currentBook.name = name;
                els.bookTitle.textContent = name;
            }
            toast('已重命名', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async function removeBook(book) {
        const ok = await confirmDialog({
            title: '删除错题本',
            message: `确定删除「${book.name}」吗？里面的错题会一起删除。`,
            confirmText: '删除',
            danger: true
        });
        if (!ok) return;

        try {
            await api.mistakeBooks.remove(book.id);
            state.books = state.books.filter(item => item.id !== book.id);
            renderBooks();
            toast('已删除', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    /* ---- 错题本详情 ---- */

    async function openBook(book) {
        state.currentBook = book;
        state.filterCategory = 'all';
        state.filterPaper = 'all';
        els.bookTitle.textContent = book.name;
        els.questionList.replaceChildren(skeletonRows(3));
        els.questionEmpty.hidden = true;
        showView('book');

        try {
            const [questions, papers] = await Promise.all([
                api.mistakeQuestions.list(book.id),
                api.mistakeQuestions.papers()
            ]);
            state.questions = questions;
            state.papers = papers;
            book.questionCount = questions.length;
            renderBook();
        } catch (err) {
            els.questionList.replaceChildren();
            els.questionEmpty.hidden = false;
            els.questionEmpty.textContent = err.message;
            toast(err.message, 'error');
        }
    }

    function usedPapers() {
        const seen = [];
        const set = new Set();
        state.questions.forEach(q => {
            const paper = q.paper || '';
            if (!paper || set.has(paper)) return;
            set.add(paper);
            seen.push(paper);
        });
        return seen;
    }

    function usedCategories() {
        const set = new Set(state.questions.map(q => q.categoryId).filter(Boolean));
        return state.categories.filter(cat => set.has(cat.id));
    }

    function categoryName(id) {
        const found = state.categories.find(cat => cat.id === id);
        return found ? found.name : '';
    }

    function renderBook() {
        const papers = usedPapers();
        const cats = usedCategories();

        // 题型 / 卷被改名或删除后，原来的筛选值可能已失效，兜底回到「全部」
        if (state.filterCategory !== 'all' && state.filterCategory !== 'none'
            && !cats.some(cat => cat.id === state.filterCategory)) {
            state.filterCategory = 'all';
        }
        if (state.filterPaper !== 'all' && state.filterPaper !== 'none'
            && !papers.includes(state.filterPaper)) {
            state.filterPaper = 'all';
        }

        els.stats.replaceChildren(
            statItem('📝', state.questions.length, '错题总数'),
            statItem('📄', papers.length, '套卷'),
            statItem('🏷', cats.length, '题型')
        );

        renderCategoryFilter(cats);
        renderPaperFilter(papers);
        renderQuestions();
    }

    function filterButton(label, active, dataset) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        if (active) btn.classList.add('active');
        Object.assign(btn.dataset, dataset);
        return btn;
    }

    function renderCategoryFilter(cats) {
        const unfiled = state.questions.some(q => !q.categoryId);
        els.categoryFilter.replaceChildren(
            filterButton(`全部 ${state.questions.length}`, state.filterCategory === 'all', { mkCat: 'all' }),
            ...cats.map(cat => {
                const count = state.questions.filter(q => q.categoryId === cat.id).length;
                return filterButton(`${cat.name} ${count}`, state.filterCategory === cat.id, { mkCat: cat.id });
            }),
            ...(unfiled ? [filterButton('未分类', state.filterCategory === 'none', { mkCat: 'none' })] : [])
        );
    }

    function renderPaperFilter(papers) {
        els.paperFilter.replaceChildren(
            filterButton('全部卷', state.filterPaper === 'all', { mkPaper: 'all' }),
            ...papers.map(paper => filterButton(paper, state.filterPaper === paper, { mkPaper: paper })),
            ...(state.questions.some(q => !q.paper)
                ? [filterButton('未标卷名', state.filterPaper === 'none', { mkPaper: 'none' })]
                : [])
        );
        els.paperFilter.hidden = papers.length < 2 && !state.questions.some(q => !q.paper);
    }

    function visibleQuestions() {
        return state.questions.filter(q => {
            if (state.filterCategory === 'none') {
                if (q.categoryId) return false;
            } else if (state.filterCategory !== 'all' && q.categoryId !== state.filterCategory) {
                return false;
            }

            if (state.filterPaper === 'none') {
                if (q.paper) return false;
            } else if (state.filterPaper !== 'all' && q.paper !== state.filterPaper) {
                return false;
            }

            return true;
        });
    }

    function compareQuestion(a, b) {
        const na = parseFloat(a.number);
        const nb = parseFloat(b.number);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a.createdAt).localeCompare(String(b.createdAt));
    }

    function renderQuestions() {
        const list = visibleQuestions();
        els.questionEmpty.hidden = list.length > 0;
        els.questionEmpty.textContent = state.questions.length
            ? '这个筛选条件下还没有错题'
            : '还没有错题，点右上角「＋ 导入错题」上传截图开始整理';
        els.questionList.replaceChildren();

        const groups = new Map();
        list.forEach(q => {
            const key = q.paper || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(q);
        });

        const ordered = [...groups.entries()].sort((a, b) => {
            if (!a[0]) return 1;
            if (!b[0]) return -1;
            return a[0].localeCompare(b[0], 'zh');
        });

        const fragment = document.createDocumentFragment();
        ordered.forEach(([paper, items]) => {
            const section = document.createElement('div');
            section.className = 'mk-paper-group';

            const head = document.createElement('div');
            head.className = 'mk-paper-head';
            head.textContent = paper || '未标卷名';
            section.appendChild(head);

            items.sort(compareQuestion).forEach(q => section.appendChild(renderQuestionCard(q)));
            fragment.appendChild(section);
        });

        els.questionList.appendChild(fragment);
    }

    function renderQuestionCard(q) {
        const card = document.createElement('div');
        card.className = 'mk-question';

        const head = document.createElement('div');
        head.className = 'mk-q-head';

        const no = document.createElement('span');
        no.className = 'mk-q-no';
        no.textContent = q.number ? `第 ${q.number} 题` : '题目';

        head.appendChild(no);

        const catName = categoryName(q.categoryId);
        if (catName) {
            const tag = document.createElement('span');
            tag.className = 'mk-tag';
            tag.textContent = catName;
            head.appendChild(tag);
        }

        const actions = document.createElement('div');
        actions.className = 'mk-q-actions';

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'report-btn';
        edit.textContent = '编辑';
        edit.addEventListener('click', () => openForm({ question: q }));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-btn';
        del.textContent = '删除';
        del.addEventListener('click', () => removeQuestion(q));

        actions.append(edit, del);
        head.appendChild(actions);
        card.appendChild(head);

        if (q.stem) {
            const stem = document.createElement('div');
            stem.className = 'mk-q-stem';
            stem.textContent = q.stem;
            card.appendChild(stem);
        }

        if (q.options && q.options.length) {
            const box = document.createElement('div');
            box.className = 'mk-options-read';
            q.options.forEach(opt => {
                const row = document.createElement('div');
                row.className = 'mk-option';
                if (q.answer && opt.label && opt.label.toUpperCase() === q.answer.toUpperCase()) {
                    row.classList.add('is-answer');
                }
                const label = document.createElement('span');
                label.className = 'mk-option-label';
                label.textContent = opt.label;
                const text = document.createElement('span');
                text.textContent = opt.text;
                row.append(label, text);
                box.appendChild(row);
            });
            card.appendChild(box);
        }

        if (q.answer || q.myAnswer) {
            const line = document.createElement('div');
            line.className = 'mk-q-answer';
            if (q.answer) {
                const right = document.createElement('span');
                right.className = 'mk-answer-right';
                right.textContent = `正确答案：${q.answer}`;
                line.appendChild(right);
            }
            if (q.myAnswer) {
                const mine = document.createElement('span');
                mine.className = 'mk-answer-mine';
                mine.textContent = `我的答案：${q.myAnswer}`;
                line.appendChild(mine);
            }
            card.appendChild(line);
        }

        if (q.analysis) {
            const analysis = document.createElement('div');
            analysis.className = 'mk-q-analysis';
            analysis.textContent = `解析：${q.analysis}`;
            card.appendChild(analysis);
        }

        (q.images || []).forEach(url => {
            const img = document.createElement('img');
            img.className = 'mk-q-image';
            img.src = url;
            img.alt = '题目截图';
            img.loading = 'lazy';
            img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
            card.appendChild(img);
        });

        return card;
    }

    async function removeQuestion(q) {
        const ok = await confirmDialog({
            title: '删除错题',
            message: '确定删除这道错题吗？',
            confirmText: '删除',
            danger: true
        });
        if (!ok) return;

        try {
            await api.mistakeQuestions.remove(q.id);
            state.questions = state.questions.filter(item => item.id !== q.id);
            if (state.currentBook) state.currentBook.questionCount = state.questions.length;
            renderBook();
            toast('已删除', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    /* ---- 导入 / 编辑表单 ---- */

    function buildOptionRows() {
        OPTION_LABELS.forEach(label => {
            const row = document.createElement('div');
            row.className = 'mk-option-row';

            const tag = document.createElement('span');
            tag.className = 'mk-option-label';
            tag.textContent = label;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'text-input';
            input.placeholder = `选项 ${label}`;

            row.append(tag, input);
            els.options.appendChild(row);
            optionInputs[label] = input;
        });
    }

    function renderCategorySelect() {
        els.category.innerHTML = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '（未分类）';
        els.category.appendChild(none);

        state.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            els.category.appendChild(opt);
        });
    }

    function renderPaperOptions() {
        els.paperOptions.replaceChildren();
        state.papers.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.paper;
            els.paperOptions.appendChild(opt);
        });
    }

    function renderShotPreview() {
        els.shotPreview.replaceChildren();
        if (!state.shot) {
            els.shotPreview.hidden = true;
            return;
        }
        els.shotPreview.hidden = false;

        const img = document.createElement('img');
        img.src = state.shot;
        img.alt = '题目截图';

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'image-preview-del';
        remove.textContent = '×';
        remove.setAttribute('aria-label', '移除截图');
        remove.addEventListener('click', () => {
            state.shot = '';
            renderShotPreview();
        });

        els.shotPreview.append(img, remove);
    }

    function clearQuestionFields() {
        els.number.value = '';
        els.stem.value = '';
        els.answer.value = '';
        els.myAnswer.value = '';
        els.analysis.value = '';
        OPTION_LABELS.forEach(label => {
            optionInputs[label].value = '';
        });
        state.shot = '';
        setStatus(els.screenshotStatus, '');
        renderShotPreview();
    }

    // 打开表单：question 有值即编辑，否则新建
    function openForm({ question = null } = {}) {
        if (!state.currentBook) return;

        state.editing = question;
        state.shot = '';
        renderCategorySelect();
        renderPaperOptions();
        els.formTitle.textContent = question
            ? `编辑错题 · ${state.currentBook.name}`
            : `导入错题 · ${state.currentBook.name}`;

        clearQuestionFields();
        els.categoryInline.hidden = true;
        els.categoryInlineInput.value = '';

        if (question) {
            els.paper.value = question.paper || '';
            els.number.value = question.number || '';
            els.category.value = question.categoryId || '';
            els.answer.value = question.answer || '';
            els.myAnswer.value = question.myAnswer || '';
            els.analysis.value = question.analysis || '';
            els.stem.value = question.stem || '';
            (question.options || []).forEach(opt => {
                const input = optionInputs[opt.label && opt.label.toUpperCase()];
                if (input) input.value = opt.text || '';
            });
            state.shot = (question.images || [])[0] || '';
            renderShotPreview();
        }

        showView('form');
    }

    // OCR 结果预填：只在对应字段为空时填，免得覆盖用户已经手改的内容
    function applyParsed(parsed) {
        let filled = 0;
        if (parsed.paper && !els.paper.value.trim()) {
            els.paper.value = parsed.paper;
            filled += 1;
        }
        if (parsed.number && !els.number.value.trim()) {
            els.number.value = parsed.number;
            filled += 1;
        }
        if (parsed.stem && !els.stem.value.trim()) {
            els.stem.value = parsed.stem;
            filled += 1;
        }
        if (parsed.options.length && !OPTION_LABELS.some(label => optionInputs[label].value.trim())) {
            parsed.options.forEach(opt => {
                const input = optionInputs[opt.label];
                if (input) input.value = opt.text;
            });
            filled += 1;
        }
        return filled;
    }

    async function handleScreenshot(file) {
        if (!file) return;

        setLoading(els.screenshotBtn, true);

        // 先把图存下来（这一步是可靠的），再尝试识别；识别失败也不影响已保存的截图
        setStatus(els.screenshotStatus, '正在上传截图…');
        let uploaded = false;
        try {
            const { url } = await api.mistakeQuestions.uploadImage(file);
            state.shot = url;
            renderShotPreview();
            uploaded = true;
        } catch (err) {
            setStatus(els.screenshotStatus, `截图上传失败：${err.message}`, 'error');
        }

        setStatus(els.screenshotStatus, '正在识别截图…');
        try {
            const text = await ocrImage(file, {
                lang: OCR_LANG,
                onStatus: msg => setStatus(els.screenshotStatus, msg)
            });

            const filled = applyParsed(parseQuestionText(text));
            setStatus(
                els.screenshotStatus,
                filled ? '识别完成，请核对下面的内容（可直接修改）' : '识别完成，但没提取到新字段，请手动填写',
                filled ? 'ok' : ''
            );
        } catch (err) {
            const message = uploaded ? `截图已保存，但自动识别失败：${err.message}` : err.message;
            setStatus(els.screenshotStatus, message, 'error');
            if (!uploaded) toast(err.message, 'error');
        } finally {
            setLoading(els.screenshotBtn, false);
        }
    }

    function collectForm() {
        return {
            categoryId: els.category.value || null,
            paper: els.paper.value.trim(),
            number: els.number.value.trim(),
            stem: els.stem.value.trim(),
            options: OPTION_LABELS
                .map(label => ({ label, text: optionInputs[label].value.trim() }))
                .filter(opt => opt.text),
            answer: els.answer.value.trim(),
            myAnswer: els.myAnswer.value.trim(),
            analysis: els.analysis.value.trim(),
            images: state.shot ? [state.shot] : []
        };
    }

    async function saveForm(continueNext) {
        const book = state.currentBook;
        if (!book) return;

        const data = collectForm();
        if (!data.stem && !data.images.length) {
            return toast('题干和截图至少填一样', 'error');
        }

        setLoading(els.save, true);
        setLoading(els.saveNext, true);

        try {
            if (state.editing) {
                await api.mistakeQuestions.update(state.editing.id, data);
                toast('已保存', 'success');
                await openBook(book);
                return;
            }

            await api.mistakeQuestions.create({ bookId: book.id, ...data });
            book.questionCount += 1;

            if (continueNext) {
                // 保留卷名与题型，清掉题目本身，方便连着录入同一套卷的下一题
                clearQuestionFields();
                els.stem.focus();
                toast('已保存，可以继续导入下一题', 'success');
                refreshPapers();
            } else {
                toast('已保存', 'success');
                await openBook(book);
            }
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setLoading(els.save, false);
            setLoading(els.saveNext, false);
        }
    }

    // 「保存并继续」后卷名候选可能变了，后台刷新一下
    async function refreshPapers() {
        try {
            state.papers = await api.mistakeQuestions.papers();
            renderPaperOptions();
        } catch {
            /* 候选刷新失败不影响继续录入 */
        }
    }

    /* ---- 题型管理 ---- */

    function renderCategories() {
        els.categoryEmpty.textContent = '还没有题型，在上面输入框里新建一个吧';
        els.categoryEmpty.hidden = state.categories.length > 0;
        els.categoryList.replaceChildren();

        const fragment = document.createDocumentFragment();
        state.categories.forEach(cat => {
            const row = document.createElement('div');
            row.className = 'book-item';

            const main = document.createElement('div');
            main.className = 'book-main';

            const name = document.createElement('span');
            name.className = 'book-name';
            name.textContent = cat.name;

            const count = document.createElement('span');
            count.className = 'book-sub';
            // 只有打开了具体某本错题本时，这个题数才有意义
            count.textContent = state.currentBook
                ? `${state.questions.filter(q => q.categoryId === cat.id).length} 道错题`
                : '';

            main.append(name, count);

            const rename = document.createElement('button');
            rename.type = 'button';
            rename.className = 'report-btn';
            rename.textContent = '改名';
            rename.addEventListener('click', () => renameCategory(cat));

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'delete-btn';
            del.textContent = '删除';
            del.addEventListener('click', () => removeCategory(cat));

            row.append(main, rename, del);
            fragment.appendChild(row);
        });

        els.categoryList.appendChild(fragment);
    }

    async function createCategory(name, { autoSelect = false } = {}) {
        const text = String(name || '').trim();
        if (!text) return null;

        if (state.categories.some(cat => cat.name === text)) {
            toast('已经有同名题型了', 'info');
            if (autoSelect) {
                const found = state.categories.find(cat => cat.name === text);
                if (found) els.category.value = found.id;
            }
            return null;
        }

        try {
            const { category } = await api.mistakeCategories.create({ name: text, sort: state.categories.length });
            state.categories.push(category);
            return category;
        } catch (err) {
            toast(err.message, 'error');
            return null;
        }
    }

    async function renameCategory(cat) {
        const name = await textPrompt({ title: '重命名题型', value: cat.name, confirmText: '保存' });
        if (!name || name === cat.name) return;

        try {
            await api.mistakeCategories.rename(cat.id, name);
            cat.name = name;
            renderCategories();
            renderBook();
            toast('已重命名', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async function removeCategory(cat) {
        const ok = await confirmDialog({
            title: '删除题型',
            message: `确定删除题型「${cat.name}」吗？已用该题型的错题会变成「未分类」。`,
            confirmText: '删除',
            danger: true
        });
        if (!ok) return;

        try {
            await api.mistakeCategories.remove(cat.id);
            state.categories = state.categories.filter(item => item.id !== cat.id);
            state.questions.forEach(q => {
                if (q.categoryId === cat.id) q.categoryId = null;
            });
            renderCategories();
            toast('已删除', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async function openCategories() {
        showView('categories');
        els.categoryList.replaceChildren(skeletonRows(2));
        els.categoryEmpty.hidden = true;

        try {
            state.categories = await api.mistakeCategories.list();
            renderCategories();
        } catch (err) {
            els.categoryList.replaceChildren();
            els.categoryEmpty.hidden = false;
            els.categoryEmpty.textContent = err.message;
            toast(err.message, 'error');
        }
    }

    /* ---- 事件绑定 ---- */

    function bind() {
        buildOptionRows();

        els.newBookBtn.addEventListener('click', createBook);
        els.categoriesBtn.addEventListener('click', openCategories);
        els.categoriesBack.addEventListener('click', () => {
            showView('home');
            renderBooks();
        });

        els.bookBack.addEventListener('click', () => {
            showView('home');
            renderBooks();
        });
        els.importBtn.addEventListener('click', () => openForm());

        els.categoryFilter.addEventListener('click', e => {
            const btn = e.target.closest('button[data-mk-cat]');
            if (!btn) return;
            state.filterCategory = btn.dataset.mkCat;
            renderBook();
        });
        els.paperFilter.addEventListener('click', e => {
            const btn = e.target.closest('button[data-mk-paper]');
            if (!btn) return;
            state.filterPaper = btn.dataset.mkPaper;
            renderBook();
        });

        // 表单：截图上传（点击 + 拖拽）
        els.screenshotBtn.addEventListener('click', () => els.screenshot.click());
        els.screenshot.addEventListener('change', () => {
            const file = els.screenshot.files[0];
            els.screenshot.value = '';
            handleScreenshot(file);
        });
        [els.screenshotBtn, els.shotPreview].forEach(el => {
            el.addEventListener('dragover', e => {
                e.preventDefault();
                el.classList.add('drop-target');
            });
            el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
            el.addEventListener('drop', e => {
                e.preventDefault();
                el.classList.remove('drop-target');
                const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                handleScreenshot(file);
            });
        });

        els.formCancel.addEventListener('click', () => {
            if (state.currentBook) openBook(state.currentBook);
            else showView('home');
        });
        els.save.addEventListener('click', () => saveForm(false));
        els.saveNext.addEventListener('click', () => saveForm(true));

        // 表单内联新建题型
        els.addCategoryBtn.addEventListener('click', () => {
            const show = els.categoryInline.hidden;
            els.categoryInline.hidden = !show;
            if (show) els.categoryInlineInput.focus();
        });
        const submitInlineCategory = async () => {
            const category = await createCategory(els.categoryInlineInput.value, { autoSelect: true });
            if (category) {
                els.categoryInlineInput.value = '';
                els.categoryInline.hidden = true;
                renderCategorySelect();
                els.category.value = category.id;
            }
        };
        els.categoryInlineOk.addEventListener('click', submitInlineCategory);
        els.categoryInlineInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') submitInlineCategory();
        });
        els.categoryInlineCancel.addEventListener('click', () => {
            els.categoryInlineInput.value = '';
            els.categoryInline.hidden = true;
        });

        // 题型管理页：新建
        const submitNewCategory = async () => {
            const category = await createCategory(els.newCategory.value);
            if (category) {
                els.newCategory.value = '';
                renderCategories();
            }
        };
        els.addCategory.addEventListener('click', submitNewCategory);
        els.newCategory.addEventListener('keydown', e => {
            if (e.key === 'Enter') submitNewCategory();
        });
    }

    bind();

    return { activate };
}
