// 离线英汉词典
//
// 数据：vendor/dict/en_zh.txt（约 3MB，只在使用字典页时加载一次，之后完全离线）
// 来源：ECDICT（MIT License），已裁剪为常用词条，详见 vendor/dict/README.md
// 格式：单词<TAB>中文释义；多义项之间是字面 \n，显示时再还原成换行

const DICT_URL = new URL('../vendor/dict/en_zh.txt', import.meta.url).href;

let dict = null;
let loading = null;

export function dictReady() {
    return !!dict;
}

export function loadDictionary() {
    if (dict) return Promise.resolve(dict);
    if (loading) return loading;

    loading = fetch(DICT_URL)
        .then(response => {
            if (!response.ok) throw new Error(`词典加载失败（${response.status}）`);
            return response.text();
        })
        .then(text => {
            const map = new Map();
            // 按 \r?\n 切，避免 Windows 下签出成 CRLF 时把 \r 带进释义
            for (const line of text.split(/\r?\n/)) {
                const tab = line.indexOf('\t');
                if (tab > 0) map.set(line.slice(0, tab).trim().toLowerCase(), line.slice(tab + 1));
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

// 查不到时返回空串
export function meaningOf(term) {
    if (!dict || !term) return '';

    const key = String(term).trim().toLowerCase();
    if (dict.has(key)) return dict.get(key);

    // 去掉括号、词性等修饰后再查一次
    const stripped = key.replace(/[^a-z'\- ]/g, '').trim();
    return (stripped && dict.get(stripped)) || '';
}

// 释义里的字面 \n / \r 还原成一行行
export function meaningLines(meaning) {
    return String(meaning || '')
        .split(/\\r\\n|\\n|\\r/)
        .map(line => line.trim())
        .filter(Boolean);
}
