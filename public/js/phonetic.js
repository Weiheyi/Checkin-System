// 音标与发音
//
// 音标：本地词典（vendor/ipa/en_US.txt，约 2.9MB，只在用到时加载一次）
// 发音：浏览器内置语音合成，优先选美音，完全离线

const DICT_URL = new URL('../vendor/ipa/en_US.txt', import.meta.url).href;

let dict = null;
let loading = null;

// 优先挑自然度更好的美音语音；都没有时退回任意英文语音
const PREFERRED_VOICES = [
    'Google US English',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
    'Microsoft Michelle Online (Natural) - English (United States)',
    'Microsoft Zira - English (United States)',
    'Microsoft David - English (United States)',
    'Microsoft Mark - English (United States)',
    'Samantha'
];

export function phoneticsReady() {
    return !!dict;
}

export function loadPhonetics() {
    if (dict) return Promise.resolve(dict);
    if (loading) return loading;

    loading = fetch(DICT_URL)
        .then(response => {
            if (!response.ok) throw new Error(`音标词典加载失败（${response.status}）`);
            return response.text();
        })
        .then(text => {
            const map = new Map();
            // 按 \r?\n 切，避免 Windows 下签出成 CRLF 时把 \r 带进音标
            for (const line of text.split(/\r?\n/)) {
                const tab = line.indexOf('\t');
                if (tab > 0) map.set(line.slice(0, tab).toLowerCase(), line.slice(tab + 1));
            }
            dict = map;
            return map;
        })
        .catch(error => {
            loading = null;
            throw error;
        });

    return loading;
}

// 词典未加载完或查不到时返回空串，界面上就不显示音标
export function phoneticOf(term) {
    if (!dict || !term) return '';

    const key = String(term).trim().toLowerCase();
    if (dict.has(key)) return dict.get(key);

    // 去掉括号、词性等修饰后再查一次
    const stripped = key.replace(/[^a-z'\- ]/g, '').trim();
    return (stripped && dict.get(stripped)) || '';
}

/* ---------------- 发音 ---------------- */

export function canSpeak() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const us = voices.filter(voice => /^en[-_]us$/i.test(voice.lang));
    const english = voices.filter(voice => /^en/i.test(voice.lang));
    const pool = us.length ? us : english;

    for (const name of PREFERRED_VOICES) {
        const hit = pool.find(voice => voice.name === name);
        if (hit) return hit;
    }

    return pool[0] || null;
}

export function speak(text, { rate = 0.9 } = {}) {
    if (!canSpeak() || !text) return false;

    try {
        const synth = window.speechSynthesis;
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(String(text));
        utterance.lang = 'en-US';
        utterance.rate = rate;

        const voice = pickVoice();
        if (voice) utterance.voice = voice;

        synth.speak(utterance);
        return true;
    } catch {
        return false;
    }
}

// Chromium 的语音列表是异步填充的（首次 getVoices() 常为空），
// 这里提前摸一次并订阅变化，等用户点喇叭时就能拿到候选
export function warmUpVoices() {
    if (!canSpeak()) return () => {};

    const synth = window.speechSynthesis;
    synth.getVoices();

    const onChange = () => synth.getVoices();
    synth.addEventListener('voiceschanged', onChange);
    return () => synth.removeEventListener('voiceschanged', onChange);
}
