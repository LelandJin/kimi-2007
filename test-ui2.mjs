// CDP 第二轮测试：企鹅图标、QQ秀切换、斜杠菜单、/help、/version
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.log('FAIL:', m); process.exit(1); };

async function main() {
  let targets = null;
  for (let i = 0; i < 20; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9333/json')).json();
      if (targets.some(t => t.url.includes('127.0.0.1:5270'))) break;
    } catch { /* not ready */ }
    await sleep(500);
  }
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
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面内出错: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);

  // [1] 企鹅图标 + QQ秀面板
  const s1 = JSON.parse(await evalJs(`JSON.stringify({
    penguinTb: !!document.querySelector('.tb-logo.penguin svg'),
    penguinNav: !!document.querySelector('.hd-ico.penguin svg'),
    qqAvatar: !!document.querySelector('#qqAvatar svg'),
    qqName: document.getElementById('qqName').textContent,
  })`));
  console.log('[1] 企鹅/QQ秀:', s1);
  if (!s1.penguinTb || !s1.penguinNav || !s1.qqAvatar || !s1.qqName) fail('企鹅或 QQ秀 未渲染');

  // [2] QQ秀 左右箭头切换
  const s2 = await evalJs(`(() => {
    const name0 = document.getElementById('qqName').textContent;
    document.getElementById('qqNext').click();
    const name1 = document.getElementById('qqName').textContent;
    document.getElementById('qqNext').click();
    const name2 = document.getElementById('qqName').textContent;
    document.getElementById('qqPrev').click();
    const name3 = document.getElementById('qqName').textContent;
    document.getElementById('qqPrev').click(); // 回到初始
    return JSON.stringify({ name0, name1, name2, name3 });
  })()`).then(JSON.parse);
  console.log('[2] QQ秀切换:', s2);
  if (!(s2.name0 !== s2.name1 && s2.name1 !== s2.name2 && s2.name3 === s2.name1)) fail('QQ秀箭头切换异常');

  // [3] 斜杠菜单：输入 / 弹出，前缀过滤，回车补全
  const s3 = JSON.parse(await evalJs(`(() => {
    const i = document.getElementById('input');
    i.value = '/';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const menuOpen = !document.getElementById('slashMenu').hidden;
    const total = document.querySelectorAll('.slash-item').length;
    i.value = '/mo';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    const filtered = [...document.querySelectorAll('.slash-item .slash-cmd')].map(e => e.textContent);
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return JSON.stringify({ menuOpen, total, filtered, completed: i.value });
  })()`));
  console.log('[3] 斜杠菜单:', s3);
  if (!s3.menuOpen || s3.total < 30) fail('菜单未弹出或命令不全: ' + s3.total);
  if (s3.completed !== '/model ') fail('补全失败: ' + s3.completed);

  // [4] /help 帮助卡
  const s4 = JSON.parse(await evalJs(`(() => {
    const i = document.getElementById('input');
    i.value = '/help';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return JSON.stringify({
      cleared: i.value === '',
      helpCard: !!document.querySelector('.help-card'),
      helpRows: document.querySelectorAll('.help-row').length,
    });
  })()`));
  console.log('[4] /help:', s4);
  if (!s4.cleared || !s4.helpCard || s4.helpRows < 30) fail('/help 卡片异常');

  // [5] /version 走服务器，系统消息上屏
  await evalJs(`(() => {
    const i = document.getElementById('input');
    i.value = '/version';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(1500);
  const s5 = await evalJs(`([...document.querySelectorAll('.sys-pill')].slice(-1)[0]||{}).textContent || ''`);
  console.log('[5] /version =>', s5.replace(/\n/g, ' | '));
  if (!/CLI/.test(s5)) fail('/version 系统消息未上屏');

  console.log('PASS: 企鹅图标 / QQ秀切换 / 斜杠菜单 / /help / /version 全部正常');
  process.exit(0);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
