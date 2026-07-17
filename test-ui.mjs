// CDP 端到端 UI 测试：验证输入框可用、键入回车发送、收到回复、输入框恢复
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // 等 Edge 起来
  let targets = null;
  for (let i = 0; i < 20; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9333/json')).json();
      if (targets.some(t => t.url.includes('127.0.0.1:5270'))) break;
    } catch { /* not ready */ }
    await sleep(500);
  }
  const page = targets.find(t => t.url.includes('127.0.0.1:5270'));
  if (!page) throw new Error('找不到页面 target');

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
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  await sleep(4000); // 等前端 boot + 自动打开最近聊天

  const state0 = JSON.parse(await evalJs(`JSON.stringify({
    disabled: document.getElementById('input').disabled,
    placeholder: document.getElementById('input').placeholder,
    title: document.getElementById('chatTitle').textContent,
    tb: document.getElementById('tbTitle').textContent,
    listItems: document.querySelectorAll('.chat-name').length,
    msgs: document.querySelectorAll('.msg').length,
  })`));
  console.log('[1] 打开页面后:', JSON.stringify(state0, null, 2));
  if (state0.disabled) { console.log('FAIL: 输入框仍是禁用状态'); process.exit(1); }

  // 模拟键入 + 回车发送
  const before = state0.msgs;
  await evalJs(`(() => {
    const i = document.getElementById('input');
    i.value = '请只回复两个字：收到';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return i.value;
  })()`);
  const sending = JSON.parse(await evalJs(`JSON.stringify({
    inputValue: document.getElementById('input').value,
    disabled: document.getElementById('input').disabled,
    typing: document.getElementById('typing').textContent,
  })`));
  console.log('[2] 回车后:', sending);
  if (sending.inputValue !== '') { console.log('FAIL: 回车没有触发发送（输入框未清空）'); process.exit(1); }

  // 等回复完成（输入框重新可用）
  let final = null;
  for (let k = 0; k < 30; k++) {
    await sleep(5000);
    final = JSON.parse(await evalJs(`JSON.stringify({
      disabled: document.getElementById('input').disabled,
      msgs: document.querySelectorAll('.msg').length,
      lastBody: (document.querySelector('.msg:last-child .msg-body, .msg:last-child .msg-bubble')||{}).textContent || '',
    })`));
    if (!final.disabled && final.msgs > before) break;
  }
  console.log('[3] 完成后:', final);
  if (final.disabled) { console.log('FAIL: 回复完成后输入框未恢复可用'); process.exit(1); }
  if (final.msgs <= before) { console.log('FAIL: 没有新消息上屏'); process.exit(1); }
  console.log('PASS: 键入→发送→流式回复→输入框恢复 全链路正常');
  process.exit(0);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
