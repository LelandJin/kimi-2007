// Kimi 2007 —— 2007 复古 IM 皮肤的 Kimi Code Web 版后端
// 开发运行: node server.cjs 后浏览器打开 http://127.0.0.1:5270
// 打包 exe: node build-sea.mjs （生成 Kimi2007.exe，静态文件内嵌，data.json 存于 exe 旁）
const http = require('node:http');
const { spawn, exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const APP_VERSION = '1.1.0';
const ROOT = __dirname; // SEA 模式下为 exe 所在目录
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');
const PORT = Number(process.env.KIMI2007_PORT || 5270);
const KIMI_EXE = process.env.KIMI2007_KIMI_EXE
  || path.join(os.homedir(), '.kimi-code', 'bin', process.platform === 'win32' ? 'kimi.exe' : 'kimi');

// SEA 检测（打包后静态文件从内嵌资源读取）
let sea = null;
try { sea = require('node:sea'); } catch { /* 非 SEA 环境 */ }
const isSea = () => !!(sea && sea.isSea && sea.isSea());

// ---------- 数据持久化 ----------
let db = { chats: [] };
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(db.chats)) db.chats = [];
} catch { /* 首次运行 */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('保存 data.json 失败:', e.message); }
  }, 200);
}

function findChat(id) { return db.chats.find(c => c.id === id); }

// ---------- SSE 通道 ----------
const sseClients = new Map(); // chatId -> Set<res>
function broadcast(chatId, event, data) {
  const set = sseClients.get(chatId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

// ---------- 消息工具 ----------
function pushMsg(chat, msg) {
  msg.id = crypto.randomUUID();
  msg.ts = Date.now();
  chat.messages.push(msg);
  chat.updatedAt = msg.ts;
  save();
}

// 系统提示消息（居中灰色，经典 IM 风格）
function sysMsg(chat, text) {
  const msg = { kind: 'system', text };
  pushMsg(chat, msg);
  broadcast(chat.id, 'system', msg);
}

// ---------- kimi 无头调用 ----------
const running = new Map(); // chatId -> child process

function kimiArgs(chat, text) {
  const args = [];
  if (chat.kimiSessionId) args.push('-S', chat.kimiSessionId);
  if (chat.model) args.push('-m', chat.model);
  for (const d of chat.addDirs || []) args.push('--add-dir', d);
  args.push('-p', text, '--output-format', 'stream-json');
  return args;
}

// displayText: 聊天里展示的用户消息（默认与发给模型的 text 相同，/init 等会展开）
function runKimi(chat, text, displayText) {
  const cwd = chat.cwd && fs.existsSync(chat.cwd) ? chat.cwd : os.homedir();
  const child = spawn(KIMI_EXE, kimiArgs(chat, text), { cwd, windowsHide: true });
  running.set(chat.id, child);
  broadcast(chat.id, 'status', { running: true });

  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) handleLine(chat, line);
    }
  });
  let errBuf = '';
  child.stderr.on('data', c => { errBuf += c.toString('utf8'); });

  child.on('error', err => {
    running.delete(chat.id);
    sysMsg(chat, `⚠ 无法启动 kimi：${err.message}`);
    broadcast(chat.id, 'status', { running: false });
  });

  child.on('close', code => {
    if (buf.trim()) handleLine(chat, buf.trim()); // 最后一行无换行的情况
    running.delete(chat.id);
    if (code !== 0) {
      const detail = errBuf.trim().split('\n').slice(-3).join('\n') || `退出码 ${code}`;
      sysMsg(chat, `⚠ ${detail}`);
    }
    save();
    broadcast(chat.id, 'done', { code });
    broadcast(chat.id, 'status', { running: false });
  });

  const msg = { kind: 'user', text: displayText ?? text };
  pushMsg(chat, msg);
  broadcast(chat.id, 'user', msg);
}

function handleLine(chat, line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return; } // 工具实时 stdout 等非 JSON 行，忽略
  if (!ev || typeof ev !== 'object') return;

  if (ev.role === 'meta' && ev.type === 'session.resume_hint' && ev.session_id) {
    if (!chat.kimiSessionId) { chat.kimiSessionId = ev.session_id; save(); }
    return;
  }
  if (ev.role === 'assistant' && Array.isArray(ev.tool_calls)) {
    for (const tc of ev.tool_calls) {
      const fn = tc.function || {};
      const msg = { kind: 'tool_call', name: fn.name || 'tool', args: fn.arguments || '' };
      pushMsg(chat, msg);
      broadcast(chat.id, 'tool_call', msg);
    }
    return;
  }
  if (ev.role === 'tool') {
    const msg = { kind: 'tool_result', text: String(ev.content ?? '') };
    pushMsg(chat, msg);
    broadcast(chat.id, 'tool_result', msg);
    return;
  }
  if (ev.role === 'assistant' && typeof ev.content === 'string' && ev.content.trim()) {
    const msg = { kind: 'assistant', text: ev.content };
    pushMsg(chat, msg);
    broadcast(chat.id, 'assistant', msg);
  }
}

// ---------- CLI 版本（启动时缓存） ----------
let kimiVersion = 'unknown';
exec(`"${KIMI_EXE}" -V`, { timeout: 15000 }, (err, stdout) => {
  if (!err) kimiVersion = stdout.trim().split('\n')[0] || 'unknown';
});

// ---------- 斜杠命令 ----------
const TUI_ONLY = cmd => `「/${cmd}」是终端交互模式（TUI）专属命令，Web 版无法执行。请在终端运行 kimi 后使用。`;

function runCmdOnce(args) {
  return new Promise(resolve => {
    exec(`"${KIMI_EXE}" ${args}`, { timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: (stdout || '').trim(), err: (stderr || '').trim() });
    });
  });
}

function readMcpServers() {
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.kimi-code', 'config.toml'), 'utf8');
    const names = new Set();
    for (const line of toml.split('\n')) {
      let m = line.match(/^\s*\[mcp_servers\.([^\]]+)\]/) || line.match(/^\s*\[\[mcp_servers\]\]/);
      if (m) names.add(m[1] ? m[1].trim() : '(匿名)');
      m = line.match(/^\s*name\s*=\s*"([^"]+)"/);
      if (m && names.has('(匿名)')) { names.delete('(匿名)'); names.add(m[1]); }
    }
    return [...names];
  } catch { return null; }
}

// 返回值: {openChat?} 或 null
async function dispatchCommand(chat, cmd, args) {
  switch (cmd) {
    case 'new': case 'clear': {
      if (running.has(chat.id)) return sysMsg(chat, '对方正在输出中，等回复完成后再清空。');
      chat.messages = [];
      chat.kimiSessionId = null;
      save();
      broadcast(chat.id, 'cleared', {});
      sysMsg(chat, '已开始全新会话，之前的上下文已清空。');
      return null;
    }
    case 'title': case 'rename': {
      if (!args) return sysMsg(chat, `当前标题：${chat.title}`);
      chat.title = args.slice(0, 200);
      save();
      broadcast(chat.id, 'title', { title: chat.title });
      sysMsg(chat, `标题已改为：${chat.title}`);
      return null;
    }
    case 'model': {
      if (!args) return sysMsg(chat, `当前模型：${chat.model || '默认（config.toml 配置）'}。用法：/model <模型别名>，/model default 恢复默认`);
      if (/^(default|off|reset|默认)$/.test(args)) {
        chat.model = null;
        save();
        sysMsg(chat, '已恢复默认模型。');
        return null;
      }
      chat.model = args;
      save();
      sysMsg(chat, `已切换模型为「${args}」，从下一条消息生效（kimi -m ${args}）。`);
      return null;
    }
    case 'add-dir': {
      chat.addDirs = chat.addDirs || [];
      if (!args || args === 'list') {
        return sysMsg(chat, chat.addDirs.length
          ? `附加工作目录：\n${chat.addDirs.map(d => '• ' + d).join('\n')}`
          : '没有附加工作目录。用法：/add-dir <路径>');
      }
      if (!fs.existsSync(args)) return sysMsg(chat, `⚠ 目录不存在：${args}`);
      if (!chat.addDirs.includes(args)) chat.addDirs.push(args);
      save();
      sysMsg(chat, `已添加附加工作目录：${args}（kimi --add-dir，下条消息生效）`);
      return null;
    }
    case 'version':
      sysMsg(chat, `Kimi 2007 Web 版 v${APP_VERSION}\nKimi Code CLI: ${kimiVersion}`);
      return null;
    case 'status': {
      sysMsg(chat, [
        `版本：Kimi 2007 v${APP_VERSION} / CLI ${kimiVersion}`,
        `模型：${chat.model || '默认'}`,
        `工作目录：${chat.cwd}`,
        `附加目录：${(chat.addDirs || []).join('、') || '无'}`,
        `kimi 会话：${chat.kimiSessionId || '（未建立）'}`,
        `消息数：${chat.messages.length}`,
        `状态：${running.has(chat.id) ? '输出中' : '空闲'}`,
      ].join('\n'));
      return null;
    }
    case 'tasks': case 'task': {
      const act = db.chats.filter(c => running.has(c.id));
      sysMsg(chat, act.length
        ? `正在运行的任务：\n${act.map(c => `• ${c.title}`).join('\n')}`
        : '当前没有正在运行的任务。');
      return null;
    }
    case 'usage':
      sysMsg(chat, `本聊天消息数：${chat.messages.length}；全部聊天数：${db.chats.length}。\ntoken 用量与配额查询属于 TUI 专属，请在终端 kimi 内使用 /usage。`);
      return null;
    case 'mcp': {
      const names = readMcpServers();
      sysMsg(chat, names === null
        ? '未找到 ~/.kimi-code/config.toml。'
        : names.length
          ? `config.toml 中配置的 MCP 服务器：\n${names.map(n => '• ' + n).join('\n')}\n（连接状态请在终端用 /mcp 查看）`
          : 'config.toml 中没有配置 MCP 服务器。');
      return null;
    }
    case 'export-debug-zip': {
      if (!chat.kimiSessionId) return sysMsg(chat, '本聊天还没有建立 kimi 会话，先发一条消息吧。');
      sysMsg(chat, '正在导出调试 ZIP...');
      const out = path.join(os.homedir(), 'Downloads', `codex2007-debug-${Date.now()}.zip`);
      const r = await runCmdOnce(`export ${chat.kimiSessionId} -o "${out}" -y`);
      sysMsg(chat, r.code === 0 ? `已导出：${out}` : `⚠ 导出失败：${(r.err || r.out).split('\n').slice(-2).join(' ')}`);
      return null;
    }
    case 'fork': {
      const copy = {
        id: crypto.randomUUID(),
        title: `${chat.title} 副本`,
        cwd: chat.cwd, model: chat.model || null,
        addDirs: [...(chat.addDirs || [])],
        kimiSessionId: null,
        pinned: false,
        createdAt: Date.now(), updatedAt: Date.now(),
        messages: JSON.parse(JSON.stringify(chat.messages)),
      };
      db.chats.push(copy);
      save();
      sysMsg(copy, `本聊天分叉自「${chat.title}」。显示历史已保留，模型上下文将重新开始。`);
      return { openChat: copy.id };
    }
    case 'btw': {
      const copy = {
        id: crypto.randomUUID(),
        title: args ? `btw: ${args.slice(0, 24)}` : 'btw 旁支',
        cwd: chat.cwd, model: chat.model || null,
        addDirs: [...(chat.addDirs || [])],
        kimiSessionId: null,
        pinned: false,
        createdAt: Date.now(), updatedAt: Date.now(),
        messages: [],
      };
      db.chats.push(copy);
      save();
      if (args) runKimi(copy, args);
      return { openChat: copy.id };
    }
    case 'undo': {
      if (running.has(chat.id)) return sysMsg(chat, '对方正在输出中，等回复完成后再撤回。');
      const n = Math.max(1, parseInt(args, 10) || 1);
      const userIdx = chat.messages.map((m, i) => m.kind === 'user' ? i : -1).filter(i => i >= 0);
      if (!userIdx.length) return sysMsg(chat, '没有可撤回的消息。');
      const cut = userIdx[Math.max(0, userIdx.length - n)];
      const removed = chat.messages.length - cut;
      chat.messages.splice(cut);
      chat.kimiSessionId = null;
      save();
      broadcast(chat.id, 'refresh', {});
      sysMsg(chat, `已撤回最近 ${removed} 条消息。模型上下文已重置（等价新会话）。`);
      return null;
    }
    case 'init': {
      if (running.has(chat.id)) return sysMsg(chat, '对方正在输出中，请稍候。');
      runKimi(chat,
        '分析当前项目的代码库结构、主要技术栈、构建与测试命令、代码约定，在项目根目录生成 AGENTS.md 文件。',
        '/init');
      return null;
    }
    case 'goal': {
      if (args && !/^(status|pause|resume|cancel|replace|next)\b/.test(args)) {
        if (running.has(chat.id)) return sysMsg(chat, '对方正在输出中，请稍候。');
        runKimi(chat, `/goal ${args}`); // 原样透传，kimi -p 原生支持 /goal 创建形式
        return null;
      }
      sysMsg(chat, '「/goal」的目标状态/暂停/恢复/取消等子命令是 TUI 专属。\nWeb 版支持创建形式：/goal <目标>（将以目标模式自主运行）。');
      return null;
    }
    default:
      sysMsg(chat, TUI_ONLY(cmd));
      return null;
  }
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1_000_000) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// 读取静态文件：SEA 从内嵌资源读，否则从 public/ 读
function readStatic(rel) {
  if (isSea()) {
    try { return Buffer.from(sea.getAsset(rel)); } catch { return null; }
  }
  try { return fs.readFileSync(path.join(PUBLIC_DIR, rel)); } catch { return null; }
}

function openBrowser() {
  exec(`start "" "http://127.0.0.1:${PORT}"`, () => {});
}

// 导出 Markdown
function chatToMarkdown(chat) {
  const fmt = ts => new Date(ts).toLocaleString('zh-CN');
  const lines = [`# ${chat.title}`, '', `- 工作目录: ${chat.cwd}`, `- 导出时间: ${fmt(Date.now())}`, ''];
  for (const m of chat.messages) {
    if (m.kind === 'user') lines.push(`## 🧑 Randy Lu（${fmt(m.ts)}）`, '', m.text, '');
    else if (m.kind === 'assistant') lines.push(`## 🤖 Kimi 小蓝（${fmt(m.ts)}）`, '', m.text, '');
    else if (m.kind === 'tool_call') lines.push(`### 🔧 ${m.name}（${fmt(m.ts)}）`, '', '```', m.args, '```', '');
    else if (m.kind === 'tool_result') lines.push('```', m.text, '```', '');
    else if (m.kind === 'system') lines.push(`> ${m.text.replace(/\n/g, '\n> ')}`, '');
  }
  return lines.join('\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // ----- API -----
    if (p === '/api/chats' && req.method === 'GET') {
      return sendJson(res, 200, db.chats.map(c => ({
        id: c.id, title: c.title, cwd: c.cwd, pinned: !!c.pinned,
        running: running.has(c.id), createdAt: c.createdAt, updatedAt: c.updatedAt,
        preview: (c.messages.filter(m => m.kind === 'assistant').slice(-1)[0]?.text || '').slice(0, 60),
      })));
    }

    if (p === '/api/chats' && req.method === 'POST') {
      const body = await readBody(req);
      const now = Date.now();
      const chat = {
        id: crypto.randomUUID(),
        title: String(body.title || '新聊天').slice(0, 60),
        cwd: String(body.cwd || os.homedir()),
        kimiSessionId: null,
        model: null,
        addDirs: [],
        pinned: false,
        createdAt: now, updatedAt: now,
        messages: [],
      };
      db.chats.push(chat);
      save();
      return sendJson(res, 201, { id: chat.id });
    }

    let m = p.match(/^\/api\/chats\/([\w-]+)$/);
    if (m && req.method === 'GET') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, {
        id: chat.id, title: chat.title, cwd: chat.cwd, pinned: !!chat.pinned,
        model: chat.model || null, addDirs: chat.addDirs || [],
        running: running.has(chat.id), messages: chat.messages,
      });
    }

    if (m && req.method === 'DELETE') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      const child = running.get(chat.id);
      if (child) { child.kill(); running.delete(chat.id); }
      sseClients.get(chat.id)?.forEach(r => r.end());
      sseClients.delete(chat.id);
      db.chats = db.chats.filter(c => c.id !== chat.id);
      save();
      return sendJson(res, 200, { ok: true });
    }

    m = p.match(/^\/api\/chats\/([\w-]+)\/pin$/);
    if (m && req.method === 'POST') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      chat.pinned = !chat.pinned;
      save();
      return sendJson(res, 200, { pinned: chat.pinned });
    }

    m = p.match(/^\/api\/chats\/([\w-]+)\/messages$/);
    if (m && req.method === 'POST') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      if (running.has(chat.id)) return sendJson(res, 409, { error: 'busy' });
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'empty' });
      runKimi(chat, text);
      return sendJson(res, 202, { ok: true });
    }

    m = p.match(/^\/api\/chats\/([\w-]+)\/command$/);
    if (m && req.method === 'POST') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      const cm = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      if (!cm) return sendJson(res, 400, { error: 'bad command' });
      const result = await dispatchCommand(chat, cm[1].toLowerCase(), (cm[2] || '').trim());
      return sendJson(res, 200, result || {});
    }

    m = p.match(/^\/api\/chats\/([\w-]+)\/export\.md$/);
    if (m && req.method === 'GET') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(chatToMarkdown(chat));
    }

    m = p.match(/^\/api\/chats\/([\w-]+)\/events$/);
    if (m && req.method === 'GET') {
      const chat = findChat(m[1]);
      if (!chat) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: status\ndata: ${JSON.stringify({ running: running.has(chat.id) })}\n\n`);
      let set = sseClients.get(chat.id);
      if (!set) { set = new Set(); sseClients.set(chat.id, set); }
      set.add(res);
      const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000);
      req.on('close', () => { clearInterval(ka); set.delete(res); });
      return;
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

    // ----- 静态文件 -----
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    if (rel.includes('..')) { res.writeHead(403); return res.end(); }
    const data = readStatic(rel);
    if (!data) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`端口 ${PORT} 已有实例在运行，直接打开浏览器...`);
    openBrowser();
    process.exit(0);
  }
  console.error('启动失败:', err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Kimi 2007 已启动: http://127.0.0.1:${PORT}`);
  if (!fs.existsSync(KIMI_EXE)) console.warn(`警告: 找不到 kimi 可执行文件: ${KIMI_EXE}`);
  if (isSea()) openBrowser(); // exe 双击启动时自动打开界面
});

process.on('exit', () => { for (const c of running.values()) c.kill(); });
