// 词汇量测试
//
// 题库：vendor/dict/freq.txt（FrequencyWords 5 万词与本地词典的交集，按词频重新编号）
// 释义：复用离线词典 vendor/dict/en_zh.txt
//
// 做法是这类测试通行的「分档抽样 + 自评 + 释义核对」：
//   1. 按词频把词表切成若干档，每档随机抽同样多的词（名次越大越生僻）
//   2. 只给单词，自己判断认不认识 —— 这一步不给释义，否则等于送答案
//   3. 把你说「认识」的词连释义再列一遍，让你取消虚报的
//   4. 估算 = Σ（每档词数 × 该档认识比例），再按二项分布给一个大概的浮动范围
//
// 结果是估出来的，不是数出来的：题量越大范围越窄，不用跟别的测试精确对齐。

import { api } from './api.js';
import { toast, confirmDialog } from './ui.js';
import { loadDictionary, meaningOf, meaningLines } from './dictionary.js';
import * as net from './net.js';

const FREQ_URL = new URL('../vendor/dict/freq.txt', import.meta.url).href;

// 档位边界（名次）：前密后疏，常见的词分得细一点
const BAND_CUTOFFS = [
    500, 1000, 1500, 2000,
    3000, 4000, 5000, 6000,
    7000, 8000, 9000, 10000,
    12000, 14000, 16000, 18000,
    20000, 22000, 24000
];

// 每档抽几个 → 总题量。一共 20 档，所以题量都是 20 的倍数
const SIZE_CHOICES = [
    { perBand: 3, label: '60 题（快）' },
    { perBand: 5, label: '100 题（推荐）' },
    { perBand: 7, label: '140 题（更准）' }
];

let ranking = null;
let rankingLoading = null;

export function rankingReady() {
    return !!ranking;
}

export function loadRanking() {
    if (ranking) return Promise.resolve(ranking);
    if (rankingLoading) return rankingLoading;

    rankingLoading = fetch(FREQ_URL)
        .then(response => {
            if (!response.ok) throw new Error(`词频表加载失败（${response.status}）`);
            return response.text();
        })
        .then(text => {
            const list = [];
            for (const line of text.split(/\r?\n/)) {
                const tab = line.indexOf('\t');
                if (tab > 0) list.push(line.slice(0, tab).trim());
            }
            if (!list.length) throw new Error('词频表是空的');
            ranking = list;
            return list;
        })
        .catch(error => {
            rankingLoading = null;
            throw error;
        });

    return rankingLoading;
}

/* ---------------- 抽样与估算 ---------------- */

// 按名次切档；词表有多少算多少，最后一档到末尾
function buildBands(words) {
    const bands = [];
    let start = 0;

    for (const cutoff of BAND_CUTOFFS) {
        const end = Math.min(cutoff, words.length);
        if (end > start) bands.push(makeBand(words, start, end));
        start = end;
    }
    if (start < words.length) bands.push(makeBand(words, start, words.length));

    return bands;
}

function makeBand(words, start, end) {
    return {
        from: start + 1,
        to: end,
        size: end - start,
        slice: words.slice(start, end),
        sampled: 0,
        known: 0
    };
}

// Fisher-Yates，不重复地随机取 count 个
function sample(list, count) {
    const pool = list.slice();
    const total = Math.min(count, pool.length);

    for (let i = 0; i < total; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool.slice(0, total);
}

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// Σ(档位大小 × 认识比例)；浮动范围由各档二项分布的方差加起来算出
function estimateSize(bands) {
    let estimate = 0;
    let variance = 0;

    for (const band of bands) {
        if (!band.sampled) continue;
        const ratio = band.known / band.sampled;
        estimate += band.size * ratio;
        variance += (band.size * band.size * ratio * (1 - ratio)) / band.sampled;
    }

    const margin = Math.round(1.96 * Math.sqrt(variance));
    const round50 = value => Math.round(value / 50) * 50;
    const value = round50(estimate);

    return {
        estimate: value,
        low: Math.max(0, round50(value - margin)),
        high: round50(value + margin)
    };
}

/* ---------------- 小工具 ---------------- */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function formatDay(iso) {
    const date = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(ms) {
    const seconds = Math.max(0, Math.round((ms || 0) / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function bandLabel(band) {
    return band.from === band.to ? `${band.from}` : `${band.from}-${band.to}`;
}

// 表还没建好时的报错长得都一样，统一换成一句能照做的提示
function schemaHint(message) {
    return /vocab_tests/.test(message)
        ? '请先把最新的 supabase/schema.sql 整段再执行一次'
        : message;
}

/* ---------------- 工具本体 ---------------- */

// panel 是 <section id="panel-vocab">，内部结构见 tools.html
export function createVocabTool(panel) {
    if (!panel) return { activate() {} };

    const els = {
        intro: panel.querySelector('#vocabIntro'),
        introHint: panel.querySelector('#vocabIntroHint'),
        sizes: panel.querySelector('#vocabSizes'),
        start: panel.querySelector('#vocabStart'),
        history: panel.querySelector('#vocabHistory'),

        quiz: panel.querySelector('#vocabQuiz'),
        bar: panel.querySelector('#vocabBar'),
        progress: panel.querySelector('#vocabProgress'),
        term: panel.querySelector('#vocabTerm'),
        known: panel.querySelector('#vocabKnown'),
        unknown: panel.querySelector('#vocabUnknown'),
        quit: panel.querySelector('#vocabQuit'),

        check: panel.querySelector('#vocabCheck'),
        checkList: panel.querySelector('#vocabCheckList'),
        checkDone: panel.querySelector('#vocabCheckDone'),

        result: panel.querySelector('#vocabResult')
    };

    const state = {
        perBand: 5,
        bands: [],
        queue: [],
        index: 0,
        startedAt: 0,
        historyLoaded: false
    };

    // 当前这一题：{ band, term }
    let current = null;

    function showView(view) {
        els.intro.hidden = view !== 'intro';
        els.quiz.hidden = view !== 'quiz';
        els.check.hidden = view !== 'check';
        els.result.hidden = view !== 'result';
    }

    /* ---- 进入：词库只加载一次 ---- */

    async function activate() {
        if (rankingReady()) {
            loadHistory();
            return;
        }

        els.introHint.hidden = false;
        els.introHint.textContent = '正在加载词库…';
        els.start.disabled = true;

        try {
            await Promise.all([loadRanking(), loadDictionary()]);
            els.introHint.hidden = true;
            loadHistory();
        } catch (error) {
            // 词库是大文件，只在真正用到时才缓存；没缓存过又连不上网就加载不了
            const offline = !navigator.onLine || /fetch|network/i.test(error.message);
            els.introHint.textContent = offline
                ? '词库加载失败：现在连不上网，而词库还没缓存过 —— 联网打开一次这里（或「字典」），之后就能离线用了'
                : `词库加载失败：${error.message}`;
        } finally {
            els.start.disabled = false;
        }
    }

    /* ---- 答题 ---- */

    function start() {
        if (!ranking) {
            toast('词库还没加载好，稍等一下再试', 'error');
            return;
        }

        state.bands = buildBands(ranking);

        for (const band of state.bands) {
            const picked = sample(band.slice, state.perBand);
            band.sampled = picked.length;
            band.known = 0;
            band.picked = picked;
        }

        // 打散顺序，免得一路从常见词答到生僻词
        state.queue = shuffle(state.bands.flatMap(
            band => band.picked.map(term => ({ band, term, known: false }))
        ));
        state.index = 0;
        state.startedAt = Date.now();

        showView('quiz');
        renderQuestion();
    }

    function renderQuestion() {
        current = state.queue[state.index];

        if (!current) {
            openCheck();
            return;
        }

        els.term.textContent = current.term;
        els.progress.textContent = `${state.index + 1} / ${state.queue.length}`;
        els.bar.style.width = `${(state.index / state.queue.length) * 100}%`;
    }

    function answer(known) {
        if (!current) return;

        current.known = !!known;
        if (known) current.band.known += 1;

        state.index += 1;
        renderQuestion();
    }

    async function quit() {
        const ok = await confirmDialog({
            title: '结束本次测试？',
            message: '已经答的题不会保存，也不会记进历史。',
            confirmText: '结束',
            danger: true
        });
        if (!ok) return;

        showView('intro');
        loadHistory();
    }

    /* ---- 核对：把勾了「认识」的词连释义再列一遍 ---- */

    function openCheck() {
        const claimed = state.queue.filter(item => item.known);

        // 一个都不认识就没什么好核对的，直接出结果
        if (!claimed.length) {
            showResult();
            return;
        }

        const fragment = document.createDocumentFragment();
        claimed.forEach(item => {
            const row = el('label', 'vocab-check-item');

            const mark = document.createElement('input');
            mark.type = 'checkbox';
            mark.checked = true;
            mark.dataset.term = item.term;

            const main = el('span', 'vocab-check-main');
            main.append(el('b', 'vocab-check-term', item.term));

            // 词典里的多义项是字面 \n 分隔的，拆开后并成一行显示
            const senses = meaningLines(meaningOf(item.term));
            main.append(el('span', 'vocab-check-meaning', senses.length ? senses.join('；') : '（词典里没有释义）'));

            row.append(mark, main);
            fragment.appendChild(row);
        });

        els.checkList.replaceChildren(fragment);
        showView('check');
    }

    function finishCheck() {
        // 取消勾选的 = 其实不认识，从该档的「认识」里扣掉
        let dropped = 0;

        for (const mark of els.checkList.querySelectorAll('input[type="checkbox"]')) {
            if (mark.checked) continue;
            const item = state.queue.find(entry => entry.known && entry.term === mark.dataset.term);
            if (!item) continue;
            item.known = false;
            item.band.known = Math.max(0, item.band.known - 1);
            dropped += 1;
        }

        if (dropped) toast(`扣掉了 ${dropped} 个虚报的词`, 'info');
        showResult();
    }

    /* ---- 结果 ---- */

    function showResult() {
        const bands = state.bands.filter(band => band.sampled);
        const size = estimateSize(bands);
        const knownTotal = state.queue.filter(item => item.known).length;
        const elapsed = Date.now() - state.startedAt;

        const head = el('div', 'vocab-result-head');
        head.append(el('p', 'vocab-result-label', '估算词汇量'));
        head.append(el('p', 'vocab-result-value', size.estimate.toLocaleString('en-US')));
        // 全认识或全不认识时方差为 0，区间会收成一点，那就不用显示了
        if (size.high > size.low) {
            head.append(el('p', 'vocab-result-range',
                `大概在 ${size.low.toLocaleString('en-US')} ~ ${size.high.toLocaleString('en-US')} 之间`));
        }

        const summary = el('p', 'setting-desc',
            `共 ${state.queue.length} 题，认识 ${knownTotal} 个，用时 ${formatDuration(elapsed)}。`
            + '这是按分档抽样估出来的，题量越大范围越窄。');

        const chart = el('div', 'vocab-chart');
        chart.append(el('h4', 'vocab-sub', '各频段掌握情况'));

        bands.forEach(band => {
            const row = el('div', 'vocab-band');
            row.append(el('span', 'vocab-band-label', bandLabel(band)));

            const track = el('span', 'vocab-band-track');
            const fill = el('span', 'vocab-band-fill');
            fill.style.width = `${Math.round((band.known / band.sampled) * 100)}%`;
            track.appendChild(fill);
            row.append(track);

            row.append(el('span', 'vocab-band-value', `${band.known}/${band.sampled}`));
            chart.appendChild(row);
        });

        const again = el('button', 'btn-primary', '再测一次');
        again.type = 'button';
        again.addEventListener('click', () => {
            showView('intro');
            loadHistory();
        });

        const status = el('p', 'vocab-save-status', '正在保存…');
        const actions = el('div', 'vocab-result-actions');
        actions.append(again, status);

        els.result.replaceChildren(head, summary, chart, actions);
        showView('result');

        // 一题都没答（比如词库没加载出来）就别往队列里塞一条没意义的结果
        if (!state.queue.length) {
            status.textContent = '';
            return;
        }

        saveResult({ ...size, total: state.queue.length, known: knownTotal, durationMs: elapsed, bands, status });
    }

    async function saveResult({ estimate, low, high, total, known, durationMs, bands, status }) {
        const payload = bands.map(band => ({
            from: band.from,
            to: band.to,
            size: band.size,
            sampled: band.sampled,
            known: band.known
        }));

        try {
            await api.vocab.save({ estimate, low, high, total, known, durationMs, bands: payload });
            state.historyLoaded = false;
            status.textContent = net.isOffline()
                ? '已存在本机，联网后自动补传'
                : '已保存到云端';
        } catch (error) {
            status.textContent = `保存失败：${schemaHint(error.message)}`;
        }
    }

    /* ---- 历史 ---- */

    async function loadHistory() {
        if (state.historyLoaded) return;

        const loading = el('p', 'setting-desc', '正在读取历史…');
        els.history.replaceChildren(el('h4', 'vocab-sub', '历史记录'), loading);

        try {
            const list = await api.vocab.list(30);
            state.historyLoaded = true;
            els.history.replaceChildren(renderHistory(list));
        } catch (error) {
            loading.textContent = `读取失败：${schemaHint(error.message)}`;
        }
    }

    function renderHistory(list) {
        const wrap = document.createDocumentFragment();
        wrap.append(el('h4', 'vocab-sub', '历史记录'));

        if (!list.length) {
            wrap.append(el('p', 'empty-hint', '还没有测试记录，测一次就能看到变化'));
            return wrap;
        }

        list.forEach((test, index) => {
            const row = el('div', 'vocab-history-item');

            const main = el('div', 'vocab-history-main');
            main.append(el('b', 'vocab-history-value', `${test.estimate.toLocaleString('en-US')} 词`));
            main.append(el('span', 'vocab-history-meta',
                `${formatDay(test.createdAt)} · 认识 ${test.known}/${test.total} · 用时 ${formatDuration(test.durationMs)}`));

            // 跟时间上更早的那条比，看涨了还是跌了
            const previous = list[index + 1];
            if (previous) {
                const diff = test.estimate - previous.estimate;
                main.append(el('span', `vocab-history-delta${diff >= 0 ? '' : ' down'}`,
                    `${diff >= 0 ? '+' : ''}${diff.toLocaleString('en-US')}`));
            }

            const del = el('button', 'btn-ghost vocab-history-delete', '删除');
            del.type = 'button';
            del.addEventListener('click', () => removeHistory(test));

            row.append(main, del);
            wrap.appendChild(row);
        });

        return wrap;
    }

    async function removeHistory(test) {
        const ok = await confirmDialog({
            title: '删除这条记录？',
            message: `${formatDay(test.createdAt)} 的估算结果会被删掉。`,
            confirmText: '删除',
            danger: true
        });
        if (!ok) return;

        try {
            await api.vocab.remove(test.id);
            state.historyLoaded = false;
            loadHistory();
        } catch (error) {
            toast(schemaHint(error.message), 'error');
        }
    }

    /* ---- 事件 ---- */

    // 题量按钮按常量生成，免得 HTML 与 JS 两处维护
    els.sizes.replaceChildren(...SIZE_CHOICES.map(choice => {
        const chip = el('button', `preset-chip${choice.perBand === state.perBand ? ' active' : ''}`, choice.label);
        chip.type = 'button';
        chip.dataset.perBand = choice.perBand;
        return chip;
    }));

    els.sizes.addEventListener('click', event => {
        const chip = event.target.closest('button[data-per-band]');
        if (!chip) return;
        state.perBand = Number(chip.dataset.perBand);
        for (const item of els.sizes.querySelectorAll('button')) {
            item.classList.toggle('active', item === chip);
        }
    });

    els.start.addEventListener('click', start);
    els.known.addEventListener('click', () => answer(true));
    els.unknown.addEventListener('click', () => answer(false));
    els.quit.addEventListener('click', quit);
    els.checkDone.addEventListener('click', finishCheck);

    return {
        activate,
        // 切走时把进行中的测试原地留着，回来接着答
        deactivate() {}
    };
}
