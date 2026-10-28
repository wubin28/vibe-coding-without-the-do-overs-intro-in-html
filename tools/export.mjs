// 用本机 Chrome 无头模式，把每张卡片导出为 1920×1080 PNG、单页 16:9 PDF，
// 以及供页面离线下载用的 exports/<卡片>.data.js；同时检查每张卡片是否有内容溢出。
// 用法：node tools/export.mjs（改了正文、样式或封面后重新运行）
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = await mkdtemp(join(tmpdir(), 'card-export-'));
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function waitForTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find(p => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) { /* Chrome 尚未就绪 */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Chrome 没有启动成功');
}

const ws = new WebSocket(await waitForTarget());
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
const listeners = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method && listeners.has(msg.method)) {
    listeners.get(msg.method)();
    listeners.delete(msg.method);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const once = method => new Promise(resolve => listeners.set(method, resolve));

const layoutCheck = `(() => {
  const card = document.querySelector('.card').getBoundingClientRect();
  const issues = [];
  for (const el of document.querySelectorAll('.card *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right > card.right + 1 || r.bottom > card.bottom + 1 || r.left < card.left - 1) issues.push('超出卡片：' + el.tagName + '.' + el.className + ' ' + el.textContent.trim().slice(0, 20));
  }
  const body = document.querySelector('.body');
  if (body.scrollHeight > body.clientHeight + 1) issues.push('正文区溢出 ' + (body.scrollHeight - body.clientHeight) + 'px');
  for (const el of body.querySelectorAll('*')) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') issues.push('横向溢出：' + el.className);
  const img = document.querySelector('.cover-frame img');
  return { issues, cover: img ? (img.hidden ? '占位封面' : '封面图片') : '' };
})()`;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const cards = (await readdir(root)).filter(f => /^\d\d-.*\.html$/.test(f)).sort();
let problems = 0;
for (const file of cards) {
  const stem = file.replace(/\.html$/, '');
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${pathToFileURL(join(root, file)).href}?export=1` });
  await loaded;
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))', awaitPromise: true });
  const { result } = await send('Runtime.evaluate', { expression: layoutCheck, returnByValue: true });
  const png = (await send('Page.captureScreenshot', { format: 'png' })).data;
  const pdf = (await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data;
  await writeFile(join(root, 'exports', `${stem}.png`), Buffer.from(png, 'base64'));
  await writeFile(join(root, 'exports', `${stem}.pdf`), Buffer.from(pdf, 'base64'));
  await writeFile(join(root, 'exports', `${stem}.data.js`), `/* Generated offline export payload. */\nwindow.cardExportData = ${JSON.stringify({ pdf, png })};\n`);
  problems += result.value.issues.length;
  console.log(`${file}${result.value.cover ? `（${result.value.cover}）` : ''}：${result.value.issues.length ? result.value.issues.join('；') : '排版检查通过'}`);
}
ws.close();
chrome.kill();
await new Promise(r => chrome.exitCode !== null ? r() : chrome.once('exit', r));
await rm(profile, { recursive: true, force: true });
console.log(problems ? `共 ${problems} 处排版问题` : `已导出 ${cards.length} 张卡片，排版检查全部通过`);
process.exit(problems ? 1 : 0);
