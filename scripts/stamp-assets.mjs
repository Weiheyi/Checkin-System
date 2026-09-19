// 部署时给静态资源挂上版本号（?v=提交号），避免浏览器继续用缓存的旧文件。
//
// 用法：node scripts/stamp-assets.mjs <version> [publicDir]
// 只在 GitHub Actions 的部署步骤里跑，源码本身保持原样、依旧是「无构建」。
//
// 注意两处都要挂：
//   1. HTML 里引用的本地 css / js
//   2. ES 模块之间的相对 import —— 模块 URL 不会继承父模块的 query，
//      只给入口脚本挂版本号是不够的，api.js / ui.js 这些照样会被缓存
// 词典、音标这类大体积数据文件（约 3MB）刻意不挂，否则每次发版都要重新下载。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
    console.error('用法：node scripts/stamp-assets.mjs <version> [publicDir]');
    process.exit(1);
}

const publicDir = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// 已经挂过 ?v= 的不会再匹配（URL 里不允许出现 ?），所以重复执行是安全的
function stamp(file, pattern, replace) {
    const before = readFileSync(file, 'utf8');
    const after = before.replace(pattern, replace);
    if (after === before) return false;
    writeFileSync(file, after);
    return true;
}

let count = 0;

// 1) HTML 里引用的本地样式表与脚本
const htmlRef = /(href|src)="(css\/[^"?]+\.css|(?:js|vendor)\/[^"?]+\.js)"/g;
for (const name of readdirSync(publicDir)) {
    if (!name.endsWith('.html')) continue;
    if (stamp(join(publicDir, name), htmlRef, (m, attr, url) => `${attr}="${url}?v=${version}"`)) {
        count++;
        console.log(`  public/${name}`);
    }
}

// 2) 模块之间的相对 import
const jsImport = /from\s+'(\.[^']+\.js)'/g;
for (const name of readdirSync(join(publicDir, 'js'))) {
    if (!name.endsWith('.js')) continue;
    if (stamp(join(publicDir, 'js', name), jsImport, (m, spec) => `from '${spec}?v=${version}'`)) {
        count++;
        console.log(`  public/js/${name}`);
    }
}

console.log(`已给 ${count} 个文件加上版本号 ?v=${version}`);
