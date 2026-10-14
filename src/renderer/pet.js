// 夕 · 桌宠渲染层
const api = window.duskPet; // 在浏览器里直接打开时为 undefined，用于预览
const canvas = document.getElementById('dusk-canvas');
const fx = document.getElementById('fx');

// 状态 → 官方动作
const ANIM = {
  normal: 'Relax',
  working: 'Sit',      // 坐下来专心干活，头顶冒墨点
  waiting: 'Interact',
  done: 'Interact',
  sleep: 'Sleep',
  catch: 'Interact',
  drag: 'Move',
};

const LINES = {
  normal: ['今天想画点什么？', '有文件就丢给我。', '嗯……灵感还没来。', '点我看看工作台。', '别光看，我可不是摆设。'],
  working: ['正在落笔……', '墨未干，莫催。', '这一笔得慢慢来。', '让我想想怎么构图。'],
  waiting: ['这一步要你点头。', 'Claude 在等你确认。'],
  done: ['画完了，去看看？', '收笔。', '落款，盖章。'],
  sleep: ['Zzz……', '（梦里还在作画）'],
  wake: ['……嗯？你回来了。', '刚才没睡，在构思。'],
  catch: ['给我的？', '松手吧，我接着。'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

let realState = 'normal';
let override = null; // 拖文件经过 / 拖动时的临时形象
let info = { working: 0, waiting: 0, five: null, week: null, tool: '' };
let dusk = null;
let lastAnchor = -1;

const params = new URLSearchParams(location.search);
setScale(+(params.get('scale') || 1));
function setScale(s) {
  document.documentElement.style.setProperty('--s', s);
}

const say = (text, ms) => (api ? api.say(text, ms) : console.log('[气泡]', text));

new DuskSpine(canvas, '../../assets/dusk/').load().then((d) => {
  dusk = d;
  window.__dusk = d;
  render();
}).catch((e) => {
  console.error(e);
  say('模型没加载出来……', 8000);
});

function render() {
  const state = override || realState;
  fx.dataset.state = state;
  for (const el of fx.querySelectorAll('.v')) {
    el.style.display = el.dataset.in.split(' ').includes(state) ? '' : 'none';
  }
  if (!dusk) return;
  if (state !== 'drag') dusk.flip = false;
  const anim = params.get('anim') || ANIM[state] || 'Relax';
  if (state === 'done') dusk.play('Interact', { loop: false, then: 'Relax' });
  else dusk.play(anim);
}

// 气泡要对准她的头：把脚底中心在画布里的横向位置告诉主进程
setInterval(() => {
  if (!dusk || !api || dusk.originX === undefined) return;
  const x = Math.round(dusk.originX * 100) / 100;
  if (x !== lastAnchor) { lastAnchor = x; api.anchor(x); }
}, 500);

// 常态：偶尔变出小凳子坐下摸鱼
setInterval(() => {
  if (!dusk || override || realState !== 'normal' || dusk.current !== 'Relax') return;
  if (Math.random() < 0.35) dusk.play('Special', { loop: false, then: 'Relax' });
}, 45000);

// —— 状态更新 ——
if (api) {
  api.onState((d) => {
    const prev = realState;
    info = d;
    realState = d.state;
    if (prev !== realState) {
      render();
      if (prev === 'sleep') say(pick(LINES.wake));
      else if (realState === 'working' && d.tool) say(`正在用 ${d.tool}……`);
      else if (LINES[realState]) say(pick(LINES[realState]));
    }
  });
  api.onScale(setScale);
} else {
  // 浏览器预览：?state=working 或 ?anim=Sit；按 1-6 切换状态
  realState = params.get('state') || 'normal';
  const order = ['normal', 'working', 'waiting', 'done', 'sleep', 'catch'];
  window.addEventListener('keydown', (e) => {
    const i = +e.key - 1;
    if (order[i]) { realState = order[i]; render(); }
  });
}
render();

// —— 鼠标：拖动 / 单击开面板 / 双击开 Claude / 右键菜单 ——
let down = null;
let clickTimer = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY, lastX: e.screenX, moved: false };
  api && api.dragStart({ x: e.screenX, y: e.screenY });
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  if (!down.moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 3) {
    down.moved = true;
    canvas.classList.add('dragging');
    override = 'drag';
    render();
  }
  if (!down.moved) return;
  if (dusk && Math.abs(e.screenX - down.lastX) > 2) {
    dusk.flip = e.screenX < down.lastX; // 往哪边拖就朝哪边走
    down.lastX = e.screenX;
  }
  api && api.dragMove({ x: e.screenX, y: e.screenY });
});
window.addEventListener('mouseup', () => {
  if (!down) return;
  const wasClick = !down.moved;
  down = null;
  canvas.classList.remove('dragging');
  if (override === 'drag') { override = null; render(); }
  api && api.dragEnd();
  if (!wasClick) return;
  if (clickTimer) { // 双击：打开 Claude
    clearTimeout(clickTimer); clickTimer = null;
    api && api.openClaude();
    return;
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    if (dusk && realState === 'normal') dusk.play('Interact', { loop: false, then: 'Relax' });
    api && api.togglePanel();
    const q = info.five;
    say(q && q.used != null ? `5 小时已用 ${q.estimated ? '≈' : ''}${q.used}% · 剩余 ${q.remaining}%` : '点开工作台看看用量');
  }, 260);
});
window.addEventListener('contextmenu', (e) => { e.preventDefault(); api && api.menu(); });
canvas.addEventListener('mouseenter', () => api && api.interact());

// —— 文件拖放 ——
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) { override = 'catch'; render(); say(pick(LINES.catch), 10000); }
});
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; override = null; render(); api && api.hideBubble(); }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; override = null; render();
  const paths = api ? api.pathsOf(e.dataTransfer.files) : [];
  if (!paths.length) return say('这个我拿不住……拖文件给我吧。');
  // ⌥ = 加到当前对话，⇧ = 终端；否则按设置（默认弹出选项）
  api.drop(paths, e.altKey ? 'current' : e.shiftKey ? 'terminal' : 'default');
});
