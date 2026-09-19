import { PAGES } from './config.js';
import { api } from './api.js';
import { $, toast, setLoading } from './ui.js';
import { initShell } from './shell.js';

const els = {};
const state = { session: null, logs: null };

const STATUS_LABELS = { known: '认识', vague: '模糊', again: '不认识', new: '未背' };

function pad2(n) {
    return String(n).padStart(2, '0');
}

function dayKeyOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatClock(iso) {
    const date = new Date(iso);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatStamp(iso) {
    return `${dayKeyOf(new Date(iso))} ${formatClock(iso)}`;
}

function modeLabel(mode) {
    return mode === 'quiz' ? '考核' : '背诵';
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

function resultLabel(mode, result) {
    if (mode === 'quiz') return result === 'known' ? '答对' : '答错';
    return STATUS_LABELS[result] || result;
}

function cacheElements() {
    els.title = $('#recordTitle');
    els.pdf = $('#recordPdf');
    els.back = $('#recordBack');
    els.status = $('#recordStatus');
    els.detail = $('#recordDetail');
}

function renderWords(logs, mode) {
    const host = document.createElement('div');
    host.className = 'record-words';

    if (!logs.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-hint';
        empty.textContent = '这次没有留下单词明细';
        host.appendChild(empty);
        return host;
    }

    const fragment = document.createDocumentFragment();
    logs.forEach(log => {
        const row = document.createElement('div');
        row.className = 'record-word';

        const term = document.createElement('span');
        term.className = 'record-word-term';
        term.textContent = log.term;

        const meaning = document.createElement('span');
        meaning.className = 'record-word-meaning';
        meaning.textContent = log.meaning || '—';

        const badge = document.createElement('span');
        badge.className = `status-badge status-${log.result}`;
        badge.textContent = resultLabel(mode, log.result);

        row.append(term, meaning, badge);
        fragment.appendChild(row);
    });

    host.appendChild(fragment);
    return host;
}

function renderSession(session, logs) {
    const wrap = document.createElement('div');
    wrap.className = 'record-detail';

    const head = document.createElement('div');
    head.className = 'record-detail-head';

    const badge = document.createElement('span');
    badge.className = `record-badge record-badge-${session.mode}`;
    badge.textContent = modeLabel(session.mode);

    const main = document.createElement('div');
    main.className = 'record-main';

    const book = document.createElement('span');
    book.className = 'record-book';
    book.textContent = session.bookName || '（单词本已删除）';

    const meta = document.createElement('span');
    meta.className = 'record-meta';
    meta.textContent = sessionMetaText(session);

    const time = document.createElement('span');
    time.className = 'record-meta';
    time.textContent = formatStamp(session.createdAt);

    main.append(book, meta, time);
    head.append(badge, main);

    const sub = document.createElement('h4');
    sub.className = 'record-detail-sub';
    sub.textContent = `单词明细（${logs.length}）`;

    wrap.append(head, sub, renderWords(logs, session.mode));
    els.detail.replaceChildren(wrap);
}

function showError(text) {
    els.status.hidden = true;
    els.pdf.disabled = true;
    els.detail.replaceChildren();

    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = text;
    els.detail.appendChild(hint);
}

/* ---------------- 下载 PDF ---------------- */

function printEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function printTable(headers, rows) {
    const table = printEl('table', 'print-table print-logs');

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

function buildPrintReport(session, logs) {
    const report = printEl('div', 'print-report');

    const head = printEl('div', 'print-head');
    head.appendChild(printEl('h1', null, '学习记录'));
    head.appendChild(printEl('p', 'print-meta',
        `${formatStamp(session.createdAt)} · ${modeLabel(session.mode)} · ${session.bookName || '（单词本已删除）'}`));
    report.appendChild(head);

    const overview = printEl('div', 'print-summary');
    overview.appendChild(printEl('p', null, sessionMetaText(session)));
    report.appendChild(overview);

    if (!logs.length) {
        report.appendChild(printEl('p', 'print-note', '这次没有留下单词明细。'));
        return report;
    }

    const rows = logs.map(log => [log.term, log.meaning || '—', resultLabel(session.mode, log.result)]);
    const table = printTable(['单词', '释义', '结果'], rows);

    // 答错 / 不认识的词标出来，翻打印稿时好找
    [...table.tBodies[0].rows].forEach((row, index) => {
        if (logs[index].result === 'again') row.classList.add('print-bad');
    });

    report.appendChild(table);
    return report;
}

// 报告生成好挂到 body 下，用浏览器打印；在打印窗口里把目标选成「另存为 PDF」即可
function downloadPdf() {
    if (!state.session) return;

    if (!state.logs) {
        toast('单词明细还在读取，稍等一下', 'info');
        return;
    }

    setLoading(els.pdf, true);

    try {
        const report = buildPrintReport(state.session, state.logs);

        document.querySelectorAll('.print-report').forEach(node => node.remove());
        document.body.appendChild(report);

        // 打完（或取消）再放行页面，免得把界面一起打进去
        const cleanup = () => {
            document.body.classList.remove('print-report-open');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);

        document.body.classList.add('print-report-open');
        window.print();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        setLoading(els.pdf, false);
    }
}

// 从列表点进来的用 back() 回到原来的「学习记录」视图，直接打开的就退回工具页
function goBack() {
    if (history.length > 1 && document.referrer.startsWith(location.origin)) {
        history.back();
        return;
    }
    location.href = PAGES.tools;
}

async function init() {
    cacheElements();
    els.pdf.addEventListener('click', downloadPdf);
    els.back.addEventListener('click', goBack);

    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
        showError('没有指定要查看的记录，请从「学习记录」列表点进来');
        return;
    }

    els.detail.textContent = '加载中…';

    try {
        const session = await api.wordbooks.session(id);
        if (!session) {
            showError('这条学习记录不存在，可能已经被删除');
            return;
        }

        state.session = session;
        els.title.textContent = `📅 ${modeLabel(session.mode)}记录`;
        // 打印成 PDF 时浏览器会拿它当默认文件名
        document.title = `学习记录-${session.bookName || '单词本已删除'}-${dayKeyOf(new Date(session.createdAt))}`;

        els.status.hidden = false;
        els.status.textContent = '正在读取单词明细…';

        state.logs = await api.wordbooks.sessionLogs(session.id);
        els.status.hidden = true;
        renderSession(session, state.logs);
    } catch (err) {
        showError(err.message);
    }
}

if (initShell({ active: 'tools' })) init();
