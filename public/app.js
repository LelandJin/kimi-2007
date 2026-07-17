// Kimi 2007 —— 前端聊天逻辑（含斜杠命令层）
(() => {
  const $ = id => document.getElementById(id);
  const messagesEl = $('messages');
  const inputEl = $('input');
  const sendBtn = $('sendBtn');
  const typingEl = $('typing');
  const slashMenu = $('slashMenu');

  const BOT_NAME = 'Kimi 小蓝';
  const PLACEHOLDER_IDLE = '和 Kimi 小蓝聊天吧（输入 / 打开命令菜单）';
  const PLACEHOLDER_NOCHAT = '先在左侧选择一个聊天，或点「新建任务」';
  const PLACEHOLDER_RUNNING = '对方正在输入，请稍候...';

  let chats = [];
  let currentId = null;
  let es = null;
  let running = false;

  // ---------- 斜杠命令表 ----------
  // action: local(前端处理) | server(后端处理) | passthrough(原样发给模型) | tui(终端专属提示) | export-md(下载)
  const COMMANDS = [
    // 账户与配置
    { name: 'login', alias: [], desc: '选择账户并登录', action: 'tui', group: '账户配置' },
    { name: 'logout', alias: [], desc: '清除当前账户凭据', action: 'tui', group: '账户配置' },
    { name: 'provider', alias: [], desc: '管理模型供应商', action: 'tui', group: '账户配置' },
    { name: 'model', alias: [], desc: '切换本会话模型：/model <别名>', action: 'server', group: '账户配置' },
    { name: 'settings', alias: ['config'], desc: '设置面板', action: 'tui', group: '账户配置' },
    { name: 'experiments', alias: ['experimental'], desc: '实验功能面板', action: 'tui', group: '账户配置' },
    { name: 'permission', alias: [], desc: '选择权限模式', action: 'tui', group: '账户配置' },
    { name: 'editor', alias: [], desc: '配置外部编辑器', action: 'tui', group: '账户配置' },
    { name: 'theme', alias: [], desc: '切换主题', action: 'tui', group: '账户配置' },
    // 会话管理
    { name: 'new', alias: ['clear'], desc: '开始全新会话，丢弃当前上下文', action: 'server', group: '会话管理' },
    { name: 'sessions', alias: ['resume'], desc: '浏览历史会话并切换', action: 'local', group: '会话管理' },
    { name: 'tasks', alias: ['task'], desc: '查看后台任务列表', action: 'server', group: '会话管理' },
    { name: 'fork', alias: [], desc: '从当前会话分叉一个副本', action: 'server', group: '会话管理' },
    { name: 'title', alias: ['rename'], desc: '查看或设置标题：/title [新标题]', action: 'server', group: '会话管理' },
    { name: 'compact', alias: [], desc: '压缩上下文（CLI 自动进行）', action: 'tui', group: '会话管理' },
    { name: 'undo', alias: [], desc: '撤回最近消息：/undo [条数]', action: 'server', group: '会话管理' },
    { name: 'reload', alias: [], desc: '重新加载会话与配置', action: 'local', group: '会话管理' },
    { name: 'reload-tui', alias: [], desc: '仅重新加载界面', action: 'local', group: '会话管理' },
    { name: 'init', alias: [], desc: '分析代码库并生成 AGENTS.md', action: 'server', group: '会话管理' },
    { name: 'export-md', alias: ['export'], desc: '导出当前会话为 Markdown', action: 'export-md', group: '会话管理' },
    { name: 'export-debug-zip', alias: [], desc: '导出调试 ZIP 到下载目录', action: 'server', group: '会话管理' },
    { name: 'add-dir', alias: [], desc: '添加附加工作目录：/add-dir [路径|list]', action: 'server', group: '会话管理' },
    // 模式与运行控制
    { name: 'yolo', alias: ['yes'], desc: 'YOLO 模式开关（无头模式工具已自动执行）', action: 'tui', group: '模式运行' },
    { name: 'auto', alias: [], desc: '自动权限模式开关', action: 'tui', group: '模式运行' },
    { name: 'plan', alias: [], desc: '计划模式开关', action: 'tui', group: '模式运行' },
    { name: 'swarm', alias: [], desc: 'Swarm 模式', action: 'tui', group: '模式运行' },
    { name: 'goal', alias: [], desc: '目标模式：/goal <目标>（创建形式可用）', action: 'server', group: '模式运行' },
    // 信息与状态
    { name: 'help', alias: ['h', '?'], desc: '显示全部命令', action: 'local', group: '信息状态' },
    { name: 'btw', alias: [], desc: '开旁支会话：/btw [问题]', action: 'server', group: '信息状态' },
    { name: 'usage', alias: [], desc: '用量信息（配额需在终端查）', action: 'server', group: '信息状态' },
    { name: 'status', alias: [], desc: '当前会话运行状态', action: 'server', group: '信息状态' },
    { name: 'mcp', alias: [], desc: '列出 MCP 服务器配置', action: 'server', group: '信息状态' },
    { name: 'plugins', alias: [], desc: '插件管理器', action: 'tui', group: '信息状态' },
    { name: 'version', alias: [], desc: '显示版本号', action: 'server', group: '信息状态' },
    { name: 'feedback', alias: [], desc: '提交反馈', action: 'tui', group: '信息状态' },
    // 技能命令（原样透传，模型经 Skill 工具解析）
    { name: 'mcp-config', alias: [], desc: '配置 MCP 服务器（技能）', action: 'passthrough', group: '技能' },
    { name: 'custom-theme', alias: [], desc: '创建自定义主题（技能）', action: 'passthrough', group: '技能' },
    { name: 'update-config', alias: [], desc: '查看/修改配置（技能）', action: 'passthrough', group: '技能' },
    { name: 'check-kimi-code-docs', alias: [], desc: '查 Kimi Code 官方文档（技能）', action: 'passthrough', group: '技能' },
    { name: 'import-from-cc-codex', alias: [], desc: '导入 CC/Kimi 配置（技能）', action: 'passthrough', group: '技能' },
    { name: 'sub-skill', alias: ['sub-skill.review', 'sub-skill.consolidate'], desc: '整理技能清单（技能）', action: 'passthrough', group: '技能' },
    { name: 'skill:', alias: [], desc: '调用任意技能：/skill:<名称>', action: 'passthrough', group: '技能' },
    // 退出
    { name: 'exit', alias: ['quit', 'q'], desc: '退出（Web 版为提示）', action: 'local', group: '退出' },
  ];

  const findCommand = cmd => COMMANDS.find(c => c.name === cmd || c.alias.includes(cmd));

  // ---------- 工具 ----------
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTime = ts => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const scrollBottom = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

  // 轻量 markdown：代码块 → 卡片，行内代码 → chip，加粗
  function mdLite(text) {
    let html = esc(text);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `\x00CODECARD\x00${esc(lang || 'code')}\x00${code.replace(/\n$/, '')}\x00`);
    html = html.replace(/`([^`\n]+)`/g, '<code class="chip">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/\x00CODECARD\x00([^\x00]*)\x00([\s\S]*?)\x00/g, (_, lang, code) =>
      `<div class="codecard"><div class="codecard-hd">${lang}<button class="copy" title="复制">📋</button></div><pre>${code}</pre></div>`);
    return html;
  }

  function codeCard(lang, code, extraClass = '') {
    const div = document.createElement('div');
    div.className = `codecard ${extraClass}`;
    div.innerHTML = `<div class="codecard-hd">${esc(lang)}<button class="copy" title="复制">📋</button></div><pre>${esc(code)}</pre>`;
    return div;
  }

  // 从工具参数里提取要展示的内容
  function toolDisplay(name, argsStr) {
    let args = null;
    try { args = JSON.parse(argsStr); } catch { /* 保留原文 */ }
    if (name === 'Bash' && args && args.command) return { lang: 'bash', code: args.command };
    if (args && args.command) return { lang: name.toLowerCase(), code: args.command };
    if (args && args.path) return { lang: name.toLowerCase(), code: `${args.path}\n${args.content || args.old_string || ''}` };
    return { lang: name.toLowerCase(), code: argsStr };
  }

  // ---------- 消息渲染 ----------
  function addMessage(msg) {
    const welcome = messagesEl.querySelector('.welcome');
    if (welcome) welcome.remove();

    if (msg.kind === 'user') {
      const div = document.createElement('div');
      div.className = 'msg msg-user';
      div.innerHTML = `
        <div class="msg-head">
          <div class="avatar me" style="width:30px;height:30px;font-size:13px">R</div>
          <span class="msg-name">Randy Lu</span>
          <span class="msg-time">${fmtTime(msg.ts)}</span>
        </div>
        <div class="msg-bubble">${esc(msg.text)}</div>`;
      messagesEl.appendChild(div);
    } else if (msg.kind === 'assistant') {
      const div = document.createElement('div');
      div.className = 'msg msg-assistant';
      div.innerHTML = `
        <div class="msg-head">
          <div class="msg-avatar">&gt;_</div>
          <span class="msg-name">${BOT_NAME}</span>
          <span class="msg-time">${fmtTime(msg.ts)}</span>
        </div>
        <div class="msg-body">${mdLite(msg.text)}</div>
        <div class="msg-ops deco"><span>👍 赞</span><span>👎 踩</span><span>🔗 分享</span><span class="t">今天 ${fmtTime(msg.ts)}</span></div>`;
      messagesEl.appendChild(div);
    } else if (msg.kind === 'system') {
      const div = document.createElement('div');
      div.className = 'msg msg-system';
      div.innerHTML = `<span class="sys-pill">${esc(msg.text).replace(/\n/g, '<br>')}</span>`;
      messagesEl.appendChild(div);
    } else if (msg.kind === 'tool_call') {
      const div = document.createElement('div');
      div.className = 'msg';
      const body = document.createElement('div');
      body.className = 'msg-body';
      const d = toolDisplay(msg.name, msg.args);
      body.appendChild(codeCard(d.lang, d.code));
      div.appendChild(body);
      messagesEl.appendChild(div);
    } else if (msg.kind === 'tool_result') {
      const div = document.createElement('div');
      div.className = 'msg';
      const body = document.createElement('div');
      body.className = 'msg-body';
      body.appendChild(codeCard('输出', msg.text, 'tool-result'));
      div.appendChild(body);
      messagesEl.appendChild(div);
    } else if (msg.kind === 'error') {
      const div = document.createElement('div');
      div.className = 'msg msg-error';
      div.innerHTML = `
        <div class="msg-head">
          <div class="msg-avatar">&gt;_</div>
          <span class="msg-name">系统</span>
          <span class="msg-time">${fmtTime(msg.ts || Date.now())}</span>
        </div>
        <div class="msg-body">⚠ ${esc(msg.text)}</div>`;
      messagesEl.appendChild(div);
    }
    scrollBottom();
  }

  const sysLocal = text => addMessage({ kind: 'system', text, ts: Date.now() });

  // 复制按钮（事件委托）
  messagesEl.addEventListener('click', e => {
    if (e.target.classList.contains('copy')) {
      const pre = e.target.closest('.codecard').querySelector('pre');
      navigator.clipboard.writeText(pre.textContent).then(() => {
        e.target.textContent = '✅';
        setTimeout(() => { e.target.textContent = '📋'; }, 1200);
      });
      return;
    }
    const sess = e.target.closest('[data-open-chat]');
    if (sess) openChat(sess.dataset.openChat);
  });

  // ---------- 聊天列表 ----------
  async function loadChats() {
    const res = await fetch('/api/chats');
    chats = await res.json();
    renderChatList();
  }

  function renderChatList() {
    const pinned = chats.filter(c => c.pinned);
    const normal = chats.filter(c => !c.pinned);
    fillList($('pinnedList'), pinned);
    fillList($('chatList'), normal);
  }

  function fillList(ul, list) {
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="empty">（空）</li>';
      return;
    }
    for (const c of list) {
      const li = document.createElement('li');
      if (c.id === currentId) li.classList.add('active');
      li.title = c.cwd || '';
      li.innerHTML = `
        <span>${c.pinned ? '⭐' : '📁'}</span>
        <span class="chat-name">${esc(c.title)}${c.running ? ' <em style="color:#2a9d3f;font-style:normal">●</em>' : ''}</span>
        <span class="chat-ops">
          <button class="chat-op" data-op="pin" title="置顶">${c.pinned ? '↓' : '↑'}</button>
          <button class="chat-op" data-op="del" title="删除">✕</button>
        </span>`;
      li.addEventListener('click', async e => {
        const op = e.target.dataset?.op;
        if (op === 'pin') { e.stopPropagation(); await fetch(`/api/chats/${c.id}/pin`, { method: 'POST' }); return loadChats(); }
        if (op === 'del') {
          e.stopPropagation();
          if (!confirm(`删除聊天「${c.title}」？`)) return;
          await fetch(`/api/chats/${c.id}`, { method: 'DELETE' });
          if (currentId === c.id) closeChat();
          return loadChats();
        }
        openChat(c.id);
      });
      ul.appendChild(li);
    }
  }

  // ---------- 打开/关闭聊天 ----------
  async function openChat(id) {
    const res = await fetch(`/api/chats/${id}`);
    if (!res.ok) return;
    const chat = await res.json();
    currentId = id;
    running = !!chat.running;
    history.replaceState(null, '', `#${id}`);

    $('chatTitle').textContent = chat.title;
    $('tbTitle').textContent = `Kimi 2007 - ${chat.title}`;
    renderMessages(chat.messages);

    setRunning(running);
    updateInputState();
    renderChatList();
    connectSSE(id);
    inputEl.focus();
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    messages.forEach(addMessage);
    scrollBottom();
  }

  function closeChat() {
    currentId = null;
    running = false;
    if (es) { es.close(); es = null; }
    history.replaceState(null, '', location.pathname);
    $('chatTitle').textContent = '请选择或新建一个聊天';
    $('tbTitle').textContent = 'Kimi 2007';
    messagesEl.innerHTML = '<div class="welcome"><p>欢迎来到 <b>Kimi 2007</b>！</p><p>点左上角「新建任务」开始和 Kimi 小蓝聊天。</p></div>';
    setRunning(false);
    updateInputState();
  }

  function connectSSE(id) {
    if (es) es.close();
    es = new EventSource(`/api/chats/${id}/events`);
    es.addEventListener('user', e => addMessage(JSON.parse(e.data)));
    es.addEventListener('assistant', e => addMessage(JSON.parse(e.data)));
    es.addEventListener('system', e => addMessage(JSON.parse(e.data)));
    es.addEventListener('tool_call', e => addMessage(JSON.parse(e.data)));
    es.addEventListener('tool_result', e => addMessage(JSON.parse(e.data)));
    es.addEventListener('error', e => { try { addMessage({ kind: 'error', text: JSON.parse(e.data).text, ts: Date.now() }); } catch { /* keep-alive */ } });
    es.addEventListener('status', e => {
      const d = JSON.parse(e.data);
      setRunning(d.running);
      updateInputState();
    });
    es.addEventListener('done', () => { setRunning(false); updateInputState(); loadChats(); });
    es.addEventListener('cleared', () => { messagesEl.innerHTML = ''; });
    es.addEventListener('refresh', async () => {
      const r = await fetch(`/api/chats/${id}`);
      if (r.ok) renderMessages((await r.json()).messages);
    });
    es.addEventListener('title', e => {
      const d = JSON.parse(e.data);
      $('chatTitle').textContent = d.title;
      $('tbTitle').textContent = `Kimi 2007 - ${d.title}`;
      loadChats();
    });
  }

  function setRunning(v) {
    running = v;
    typingEl.textContent = v ? '对方正在输入...' : '';
  }

  function updateInputState() {
    const ok = currentId && !running;
    inputEl.disabled = !ok;
    sendBtn.disabled = !ok;
    inputEl.placeholder = !currentId ? PLACEHOLDER_NOCHAT : (running ? PLACEHOLDER_RUNNING : PLACEHOLDER_IDLE);
  }

  // ---------- 斜杠命令菜单 ----------
  let menuItems = [];
  let menuIndex = 0;

  function closeSlashMenu() {
    slashMenu.hidden = true;
    menuItems = [];
  }

  function updateSlashMenu() {
    const v = inputEl.value;
    const m = v.match(/^\/([^\s]*)$/);
    if (!m) { closeSlashMenu(); return; }
    const prefix = m[1].toLowerCase();
    menuItems = COMMANDS.filter(c =>
      c.name.startsWith(prefix) || c.alias.some(a => a.startsWith(prefix)));
    if (!menuItems.length) { closeSlashMenu(); return; }
    menuIndex = Math.min(menuIndex, menuItems.length - 1);
    slashMenu.innerHTML = menuItems.map((c, i) => `
      <div class="slash-item ${i === menuIndex ? 'sel' : ''}" data-i="${i}">
        <span class="slash-cmd">/${c.name}${c.name.endsWith(':') ? '' : ''}</span>
        <span class="slash-alias">${c.alias.length ? c.alias.map(a => '/' + a).join(' ') : ''}</span>
        <span class="slash-desc">${esc(c.desc)}</span>
      </div>`).join('');
    slashMenu.hidden = false;
    slashMenu.querySelectorAll('.slash-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        completeSlash(Number(el.dataset.i));
      });
    });
  }

  function moveSlash(delta) {
    menuIndex = (menuIndex + delta + menuItems.length) % menuItems.length;
    slashMenu.querySelectorAll('.slash-item').forEach((el, i) =>
      el.classList.toggle('sel', i === menuIndex));
  }

  function completeSlash(i) {
    const c = menuItems[i ?? menuIndex];
    if (!c) return;
    inputEl.value = `/${c.name.replace(/:$/, ':')}${c.name.endsWith(':') ? '' : ' '}`;
    closeSlashMenu();
    inputEl.focus();
  }

  // ---------- 斜杠命令执行 ----------
  function showHelpCard() {
    const groups = {};
    for (const c of COMMANDS) (groups[c.group] = groups[c.group] || []).push(c);
    const actionTag = { local: '本地', server: '✓', passthrough: '透传', tui: '终端', 'export-md': '✓' };
    const html = Object.entries(groups).map(([g, list]) => `
      <div class="help-group">${esc(g)}</div>
      ${list.map(c => `<div class="help-row">
        <span class="help-cmd">/${c.name}</span>
        <span class="help-desc">${esc(c.desc)}</span>
        <span class="help-tag ${c.action}">${actionTag[c.action]}</span>
      </div>`).join('')}`).join('');
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = `<div class="msg-head"><div class="msg-avatar">&gt;_</div><span class="msg-name">${BOT_NAME}</span></div>
      <div class="msg-body"><div class="help-card">
      <div class="help-tip">✓ = Web 版真实可用　透传 = 原样发给模型（含技能命令）　终端 = TUI 专属　本地 = 界面操作</div>${html}</div></div>`;
    const welcome = messagesEl.querySelector('.welcome');
    if (welcome) welcome.remove();
    messagesEl.appendChild(div);
    scrollBottom();
  }

  function showSessionsCard() {
    const div = document.createElement('div');
    div.className = 'msg';
    const rows = chats.map(c => `
      <div class="sess-row" data-open-chat="${c.id}">
        <span>${c.pinned ? '⭐' : '📁'}</span>
        <span class="sess-title">${esc(c.title)}</span>
        <span class="sess-prev">${esc(c.preview || '')}</span>
        ${c.running ? '<span style="color:#2a9d3f">●</span>' : ''}
      </div>`).join('') || '<div class="sess-row">（暂无会话）</div>';
    div.innerHTML = `<div class="msg-head"><div class="msg-avatar">&gt;_</div><span class="msg-name">${BOT_NAME}</span></div>
      <div class="msg-body"><div class="help-card"><div class="help-group">历史会话（点击切换）</div>${rows}</div></div>`;
    const welcome = messagesEl.querySelector('.welcome');
    if (welcome) welcome.remove();
    messagesEl.appendChild(div);
    scrollBottom();
  }

  async function downloadMarkdown() {
    if (!currentId) return;
    const r = await fetch(`/api/chats/${currentId}/export.md`);
    if (!r.ok) return sysLocal('⚠ 导出失败');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${$('chatTitle').textContent || 'chat'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    sysLocal('已导出 Markdown，请查看浏览器下载。');
  }

  async function handleCommand(def, rawText) {
    if (def.action === 'tui') {
      sysLocal(`「/${def.name}」是终端交互模式（TUI）专属命令，Web 版无法执行。请在终端运行 kimi 后使用。`);
    } else if (def.action === 'export-md') {
      downloadMarkdown();
    } else if (def.action === 'passthrough') {
      doSend(rawText); // 原样发给模型（技能命令由模型解析）
    } else if (def.action === 'local') {
      if (def.name === 'help') showHelpCard();
      else if (def.name === 'sessions') showSessionsCard();
      else if (def.name === 'reload' || def.name === 'reload-tui') { await loadChats(); sysLocal('界面已重新加载。'); }
      else if (def.name === 'exit') sysLocal('Web 版没有进程可退出～ 直接关闭标签页即可；服务器仍在后台为你守候。');
    } else if (def.action === 'server') {
      if (!currentId) return sysLocal('先选择一个聊天。');
      const res = await fetch(`/api/chats/${currentId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.openChat) { await loadChats(); openChat(data.openChat); }
      } else {
        sysLocal('⚠ 命令执行失败');
      }
    }
  }

  // ---------- 发送 ----------
  async function doSend(text) {
    if (!currentId || running) return;
    setRunning(true);
    updateInputState();
    const res = await fetch(`/api/chats/${currentId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.status === 409) { setRunning(false); updateInputState(); inputEl.value = text; }
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text || !currentId || running) return;
    const m = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (m) {
      const def = findCommand(m[1].toLowerCase());
      if (def) {
        inputEl.value = '';
        closeSlashMenu();
        handleCommand(def, text);
        return;
      }
      // 未匹配的 / 输入：按官方行为作为普通消息透传
    }
    inputEl.value = '';
    closeSlashMenu();
    doSend(text);
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('input', updateSlashMenu);
  inputEl.addEventListener('keydown', e => {
    if (!slashMenu.hidden && menuItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSlash(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSlash(-1); return; }
      if (e.key === 'Tab') { e.preventDefault(); completeSlash(); return; }
      if (e.key === 'Escape') { closeSlashMenu(); return; }
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        // 已精确输入完整命令名（无参数）时，回车直接执行而非补全
        const cur = inputEl.value.trim().slice(1).toLowerCase();
        const exact = !/\s/.test(inputEl.value.trim()) && menuItems.some(c => c.name === cur || c.alias.includes(cur));
        if (exact) { closeSlashMenu(); send(); return; }
        completeSlash(); return;
      }
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
    // Ctrl+Enter 换行（经典 IM 风格）
  });
  document.addEventListener('click', e => {
    if (!slashMenu.hidden && !slashMenu.contains(e.target) && e.target !== inputEl) closeSlashMenu();
  });

  // ---------- 新建聊天对话框 ----------
  const dlgMask = $('dlgMask');
  const openDlg = () => { dlgMask.hidden = false; $('dlgTitle').focus(); };
  const closeDlg = () => { dlgMask.hidden = true; };
  $('btnNewChat').addEventListener('click', openDlg);
  $('navNew').addEventListener('click', openDlg);
  $('dlgClose').addEventListener('click', closeDlg);
  $('dlgCancel').addEventListener('click', closeDlg);
  dlgMask.addEventListener('click', e => { if (e.target === dlgMask) closeDlg(); });
  $('dlgOk').addEventListener('click', async () => {
    const title = $('dlgTitle').value.trim() || '新聊天';
    const cwd = $('dlgCwd').value.trim();
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, cwd }),
    });
    const { id } = await res.json();
    closeDlg();
    $('dlgTitle').value = ''; $('dlgCwd').value = '';
    await loadChats();
    openChat(id);
  });

  $('btnChatList').addEventListener('click', loadChats);
  $('navChat').addEventListener('click', loadChats);

  // ---------- 换装秀（纯手绘 SVG，左右切换） ----------
  const QQSHOWS = [
    { name: '经典女孩', svg: `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="qqbg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8d7ee"/><stop offset=".6" stop-color="#d9c7f5"/><stop offset="1" stop-color="#b7ccf5"/></linearGradient></defs>
      <rect width="120" height="150" fill="url(#qqbg1)"/>
      <circle cx="18" cy="18" r="1.6" fill="#fff"/><circle cx="96" cy="30" r="1.2" fill="#fff"/><circle cx="80" cy="12" r="1" fill="#fff"/><circle cx="30" cy="42" r="1" fill="#fff"/><circle cx="105" cy="60" r="1.4" fill="#fff"/>
      <ellipse cx="38" cy="62" rx="5" ry="13" fill="#e8873a"/><ellipse cx="82" cy="62" rx="5" ry="13" fill="#e8873a"/>
      <circle cx="60" cy="52" r="24" fill="#e8873a"/>
      <circle cx="60" cy="55" r="19" fill="#ffd9c0"/>
      <path d="M41 50 Q45 34 60 34 Q75 34 79 50 Q70 42 60 44 Q50 42 41 50Z" fill="#e8873a"/>
      <ellipse cx="53" cy="56" rx="2.4" ry="3.2" fill="#333"/><ellipse cx="67" cy="56" rx="2.4" ry="3.2" fill="#333"/>
      <circle cx="48" cy="62" r="2.5" fill="#ffb0a0" opacity=".7"/><circle cx="72" cy="62" r="2.5" fill="#ffb0a0" opacity=".7"/>
      <path d="M56 64 Q60 67 64 64" stroke="#cc6666" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <rect x="56" y="72" width="8" height="7" fill="#ffd9c0"/>
      <rect x="38" y="80" width="7" height="22" rx="3.5" fill="#ffd9c0"/><rect x="75" y="80" width="7" height="22" rx="3.5" fill="#ffd9c0"/>
      <path d="M46 78 Q60 74 74 78 L76 100 L44 100 Z" fill="#ffffff" stroke="#e0e0e0"/>
      <path d="M44 100 L76 100 L78 132 L64 132 L62 112 L58 112 L56 132 L42 132 Z" fill="#5a7ab8"/>
      <ellipse cx="48" cy="136" rx="8" ry="4" fill="#fff" stroke="#ddd"/><ellipse cx="72" cy="136" rx="8" ry="4" fill="#fff" stroke="#ddd"/>
    </svg>` },
    { name: '经典男孩', svg: `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="qqbg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe4fc"/><stop offset=".6" stop-color="#aecdf2"/><stop offset="1" stop-color="#8fb4e8"/></linearGradient></defs>
      <rect width="120" height="150" fill="url(#qqbg2)"/>
      <circle cx="20" cy="16" r="1.5" fill="#fff"/><circle cx="98" cy="26" r="1.2" fill="#fff"/><circle cx="76" cy="10" r="1" fill="#fff"/><circle cx="108" cy="52" r="1.3" fill="#fff"/>
      <circle cx="60" cy="55" r="19" fill="#ffd9c0"/>
      <path d="M41 52 Q40 32 60 32 Q80 32 79 52 Q72 40 66 44 Q61 36 52 43 Q45 42 41 52Z" fill="#6b4a2f"/>
      <ellipse cx="53" cy="56" rx="2.4" ry="3.2" fill="#333"/><ellipse cx="67" cy="56" rx="2.4" ry="3.2" fill="#333"/>
      <path d="M55 64 Q60 68 65 64" stroke="#cc6666" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <rect x="56" y="72" width="8" height="7" fill="#ffd9c0"/>
      <rect x="36" y="80" width="8" height="24" rx="4" fill="#4d94f0"/><rect x="76" y="80" width="8" height="24" rx="4" fill="#4d94f0"/>
      <path d="M45 78 Q60 73 75 78 L77 104 L43 104 Z" fill="#4d94f0" stroke="#2f6cc8"/>
      <rect x="57" y="78" width="6" height="26" fill="#2f6cc8"/>
      <path d="M43 104 L77 104 L79 132 L65 132 L63 114 L57 114 L55 132 L41 132 Z" fill="#33415c"/>
      <ellipse cx="48" cy="136" rx="8" ry="4" fill="#fff" stroke="#ddd"/><ellipse cx="72" cy="136" rx="8" ry="4" fill="#fff" stroke="#ddd"/>
    </svg>` },
    { name: '机器人小蓝', svg: `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="qqbg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff0ff"/><stop offset="1" stop-color="#b3d4f5"/></linearGradient></defs>
      <rect width="120" height="150" fill="url(#qqbg3)"/>
      <circle cx="24" cy="20" r="1.5" fill="#fff"/><circle cx="94" cy="34" r="1.2" fill="#fff"/><circle cx="106" cy="14" r="1" fill="#fff"/>
      <rect x="32" y="52" width="8" height="16" rx="4" fill="#2f6cc8" stroke="#1c56c8"/>
      <rect x="80" y="52" width="8" height="16" rx="4" fill="#2f6cc8" stroke="#1c56c8"/>
      <rect x="38" y="34" width="44" height="34" rx="16" fill="#4d94f0" stroke="#1c56c8" stroke-width="1.5"/>
      <rect x="46" y="42" width="28" height="18" rx="9" fill="#14264a"/>
      <text x="60" y="55" font-family="Consolas,monospace" font-size="10" fill="#6ef0ff" text-anchor="middle" font-weight="bold">&gt;_</text>
      <rect x="46" y="70" width="28" height="22" rx="8" fill="#3b7dd8" stroke="#1c56c8"/>
      <rect x="26" y="72" width="14" height="6" rx="3" fill="#2f6cc8" stroke="#1c56c8"/>
      <rect x="80" y="72" width="14" height="6" rx="3" fill="#2f6cc8" stroke="#1c56c8"/>
      <rect x="46" y="94" width="12" height="8" rx="3" fill="#2f6cc8" stroke="#1c56c8"/>
      <rect x="62" y="94" width="12" height="8" rx="3" fill="#2f6cc8" stroke="#1c56c8"/>
      <rect x="30" y="104" width="60" height="10" rx="5" fill="#ffffff" opacity=".5"/>
    </svg>` },
    { name: '企鹅宝宝', svg: `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="qqbg4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f8ff"/><stop offset="1" stop-color="#bfe4fa"/></linearGradient></defs>
      <rect width="120" height="150" fill="url(#qqbg4)"/>
      <circle cx="20" cy="24" r="1.5" fill="#fff"/><circle cx="100" cy="16" r="1.2" fill="#fff"/><circle cx="86" cy="40" r="1" fill="#fff"/>
      <ellipse cx="36" cy="80" rx="7" ry="16" fill="#1a1a1a" transform="rotate(20 36 80)"/>
      <ellipse cx="84" cy="80" rx="7" ry="16" fill="#1a1a1a" transform="rotate(-20 84 80)"/>
      <ellipse cx="60" cy="74" rx="26" ry="32" fill="#1a1a1a"/>
      <ellipse cx="60" cy="82" rx="16" ry="22" fill="#ffffff"/>
      <circle cx="50" cy="60" r="5.5" fill="#fff"/><circle cx="70" cy="60" r="5.5" fill="#fff"/>
      <circle cx="51" cy="61" r="2.6" fill="#1a1a1a"/><circle cx="71" cy="61" r="2.6" fill="#1a1a1a"/>
      <path d="M54 68 L66 68 L60 74 Z" fill="#ff9a1a"/>
      <path d="M34 72 Q60 84 86 72 L86 78 Q60 90 34 78 Z" fill="#e03030"/>
      <path d="M76 76 L88 88 L82 92 L72 80 Z" fill="#e03030"/>
      <ellipse cx="48" cy="108" rx="7" ry="4" fill="#ff9a1a"/><ellipse cx="72" cy="108" rx="7" ry="4" fill="#ff9a1a"/>
      <rect x="24" y="118" width="72" height="8" rx="4" fill="#ffffff" opacity=".6"/>
    </svg>` },
  ];

  let qqIdx = Number(localStorage.getItem('qqshow-idx') || 0) % QQSHOWS.length;
  function renderQQShow() {
    $('qqAvatar').innerHTML = QQSHOWS[qqIdx].svg;
    $('qqName').textContent = QQSHOWS[qqIdx].name;
    localStorage.setItem('qqshow-idx', String(qqIdx));
  }
  $('qqPrev').addEventListener('click', () => { qqIdx = (qqIdx - 1 + QQSHOWS.length) % QQSHOWS.length; renderQQShow(); });
  $('qqNext').addEventListener('click', () => { qqIdx = (qqIdx + 1) % QQSHOWS.length; renderQQShow(); });
  renderQQShow();

  // ---------- 时钟 ----------
  const tick = () => { $('clock').textContent = fmtTime(Date.now()); };
  tick();
  setInterval(tick, 15000);

  // 窗口关闭时通知服务器（6 秒无重连则自动退出；刷新会重连，不受影响）
  window.addEventListener('pagehide', () => {
    try { navigator.sendBeacon('/api/shutdown'); } catch { /* 忽略 */ }
  });

  // ---------- 启动：优先打开 hash 指定的聊天，否则自动进入最近聊天 ----------
  updateInputState();
  loadChats().then(() => {
    const id = location.hash.slice(1);
    if (id) return openChat(id);
    if (chats.length) {
      const recent = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      openChat(recent.id);
    }
  });
})();
