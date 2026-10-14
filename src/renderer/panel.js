// 夕 · 工作台面板
const api = window.duskPet;
const $ = (id) => document.getElementById(id);

const STATUS = {
  working: ['✎ 处理中', 'working'],
  waiting: ['! 等你确认', 'waiting'],
  done: ['✓ 刚完成', 'done'],
  idle: ['· 空闲', 'idle'],
};
const PET_STATE = { normal: '醒着，随时待命', working: '正在落笔', waiting: '有一步在等你点头', done: '刚刚收笔', sleep: '睡着了（动一下鼠标叫醒）', catch: '在接文件' };

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}
function dur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 时 ${m % 60} 分`;
  return `${Math.floor(h / 24)} 天 ${h % 24} 时`;
}
function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function mb(bytes) {
  return bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + ' GB' : Math.round(bytes / 1024 ** 2) + ' MB';
}
function base(p) {
  return p ? p.split('/').filter(Boolean).pop() || '/' : '';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function resetText(ts, exact) {
  if (!ts) return '';
  const d = new Date(ts + 1000); // 官方重置时间是 xx:59:59.969，显示成整点
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  const when = day === 0 ? hhmm(d) : day === 1 ? `明天 ${hhmm(d)}` : `${WEEKDAY[d.getDay()]} ${hhmm(d)}`;
  return `${exact ? '' : '约 '}${when} 重置`;
}

function renderQuota(key, q) {
  const box = $(`q-${key}`);
  const used = q && q.used != null ? q.used : null;
  $(`q-${key}-used`).textContent = used == null ? '—' : `${q.estimated ? '≈' : ''}${used}%`;
  $(`q-${key}-left`).textContent = used == null ? '—' : `${q.estimated ? '≈' : ''}${q.remaining}%`;
  $(`q-${key}-bar`).style.width = `${used || 0}%`;
  box.querySelector('.meter').setAttribute('aria-valuenow', used || 0);
  $(`q-${key}-reset`).textContent = q && q.idle ? '额度已恢复' : resetText(q && q.resetAt, q && q.resetExact);
  box.classList.toggle('warn', used != null && used >= 70 && used < 90);
  box.classList.toggle('crit', used != null && used >= 90);
  $(`q-${key}-note`).textContent = used == null ? '暂无数据' : used >= 90 ? '快用完了' : used >= 70 ? '已用大半' : '';
}

function renderPlan(p) {
  $('plan-name').textContent = p && p.plan ? `${p.plan} 套餐` : '';
  renderQuota('five', p && p.five);
  renderQuota('week', p && p.week);
  if (!p || !p.available) {
    $('q-source').textContent = '暂无官方数据，点一下菜单栏的 Claude 图标试试';
    return;
  }
  const est = (p.five && p.five.estimated) || (p.week && p.week.estimated);
  const last = p.last ? `官方数据 ${hhmm(p.last.t)} 同步` : '';
  $('q-source').textContent = est ? `${last} · ≈ 为本机估算` : last;
}

function renderSessions(list) {
  $('s-count').textContent = list.length ? `${list.length} 个（12 小时内）` : '';
  $('sessions').innerHTML = list.length ? list.map((s) => {
    const [label, cls] = STATUS[s.status] || STATUS.idle;
    const extra = s.status === 'working' && s.tool ? ` · ${esc(s.tool)}` : s.status === 'waiting' && s.hookMsg ? ` · ${esc(s.hookMsg)}` : '';
    return `<li title="${esc(s.cwd)}">
      <span class="chip ${cls}">${label}</span>
      <span class="title">${esc(s.title)}</span>
      <span class="meta">${esc(base(s.cwd))}${s.model ? ' · ' + esc(s.model) : ''} · ${ago(s.mtime)}${extra}</span>
    </li>`;
  }).join('') : '<li class="empty">最近没有会话。把文件拖给夕就能开一个。</li>';
}

function renderProcs(procs, app) {
  const rows = [];
  if (app) {
    rows.push(`<li><span class="chip">桌面 App</span><span class="title">Claude · PID ${app.pid}</span>
      <span class="meta">CPU ${app.cpu.toFixed(1)}% · 内存 ${mb(app.mem)} · ${app.helpers} 个子进程 · 运行 ${dur(app.uptime)}</span></li>`);
  }
  for (const p of procs) {
    rows.push(`<li title="${esc(p.cwd)}"><span class="chip">${p.kind === 'desktop' ? 'Code 会话' : 'CLI'}</span>
      <span class="title">${esc(base(p.cwd) || 'claude')} · PID ${p.pid}</span>
      <span class="meta">CPU ${p.cpu.toFixed(1)}% · 内存 ${mb(p.mem)} · 运行 ${dur(p.uptime)}${p.model ? ' · ' + esc(p.model) : ''}</span></li>`);
  }
  $('p-count').textContent = procs.length ? `${procs.length} 个 Claude Code 进程` : '';
  $('procs').innerHTML = rows.join('') || '<li class="empty">没有发现 Claude 进程</li>';
}

function render(d) {
  if (d.character) {
    $('seal').textContent = d.character.seal;
    $('title').textContent = `${d.character.name} · 工作台`;
  }
  const busy = d.sessions.filter((s) => s.status === 'working').length;
  const wait = d.sessions.filter((s) => s.status === 'waiting').length;
  $('state-line').textContent = `${PET_STATE[d.state] || ''}${busy ? ` · ${busy} 个在忙` : ''}${wait ? ` · ${wait} 个等你` : ''}`;
  $('hook-tip').classList.toggle('hidden', !!d.hooksInstalled);
  renderPlan(d.plan);
  renderSessions(d.sessions);
  renderProcs(d.procs, d.app);
}

$('btn-close').onclick = () => api && api.closePanel();
$('btn-menu').onclick = () => api && api.panelAction('menu');
$('btn-new').onclick = () => api && api.panelAction('new');
$('btn-continue').onclick = () => api && api.panelAction('continue');
$('btn-hooks').onclick = () => api && api.panelAction('install-hooks');
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && api) api.closePanel(); });

if (api) {
  api.onPanelData(render);
} else {
  // 浏览器预览用的示例数据
  const now = Date.now();
  render({
    state: 'working', hooksInstalled: true,
    plan: {
      plan: 'Pro', available: true, calibrated: true,
      five: { used: 9, remaining: 91, estimated: true, resetAt: now + 4.4 * 3600e3, resetExact: true },
      week: { used: 74, remaining: 26, estimated: false, resetAt: now + 3.5 * 864e5, resetExact: true },
      last: { t: now - 18 * 60e3, fh: 8, sd: 74 },
    },
    sessions: [
      { status: 'working', title: '夕桌宠开发', cwd: '/Users/kuumo/claude', model: 'Opus 5.5', mtime: now - 5e3, tool: 'Bash' },
      { status: 'waiting', title: '整理笔记', cwd: '/Users/kuumo/notes', model: 'Opus 5.5', mtime: now - 60e3, hookMsg: '需要批准 Bash' },
      { status: 'idle', title: '论文排版', cwd: '/Users/kuumo/paper', model: 'deepseek-v4-pro', mtime: now - 3 * 3600e3 },
    ],
    procs: [{ pid: 30418, kind: 'desktop', cpu: 0.4, mem: 520e6, uptime: 9 * 60e3, cwd: '/Users/kuumo/claude', model: 'claude-opus-5-5' }],
    app: { pid: 28307, cpu: 27.9, mem: 3.1e9, uptime: 7 * 3600e3, helpers: 12 },
  });
}
