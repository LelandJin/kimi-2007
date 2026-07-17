// 通过 CDP 从运行中的无头 Edge 截屏
import fs from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find(t => t.url.includes('127.0.0.1:5270'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise(r => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});

// 切到「优化 KV 读写成本」聊天再截
await send('Runtime.evaluate', { expression: `location.hash = '6bdc4699-204e-4733-9552-a21f75e92a8a'; location.reload();` });
await sleep(5000);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(process.argv[2] || 'shot-codex.png', Buffer.from(shot.data, 'base64'));
console.log('saved');
process.exit(0);
