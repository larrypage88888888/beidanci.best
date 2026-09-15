import fs from 'node:fs';
const file = process.argv[2] ?? 'D:/harness3/prototypes/卡牌对战原型.html';
const html = fs.readFileSync(file, 'utf8');
const refs = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
const ids = new Set([...html.matchAll(/id=["']([^"']+)["']/g)].map((m) => m[1]));
const missing = [...new Set(refs)].filter((r) => !ids.has(r));
console.log('JS 引用的 id 数:', new Set(refs).size, '| 页面定义 id 数:', ids.size);
console.log(missing.length === 0 ? 'OK 无缺失引用' : 'MISSING: ' + missing.join(','));
const open = [...html.matchAll(/<(div|span|button|p|b|h1|h2|section|form|input)(\s|>)/g)].length;
const close = (html.match(/<\/(div|span|button|p|b|h1|h2|section|form)>/g) || []).length;
console.log('块级标签 开/闭:', open, '/', close);
for (const p of ['page-home', 'page-deck', 'page-battle', 'page-result', 'overlay', 'tabbar']) {
  console.log('  has', p, ':', html.includes('id="' + p + '"'));
}
