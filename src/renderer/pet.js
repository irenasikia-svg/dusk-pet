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
  catch: 'Interact',
  drag: 'Move',
};

const CHAR = Characters.byKey(new URLSearchParams(location.search).get('char') || 'dusk');
// 点击台词优先用游戏原台词（assets/voices.js，由 scripts/voices.js 生成），没有就用 characters.js 里的
const VOICE = (window.VOICES || {})[CHAR.charId] || {};
const LINES = { ...CHAR.lines };
for (const g of ['poke', 'combo']) if (VOICE[g] && VOICE[g].length) LINES[g] = VOICE[g];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
let lastLine = '';
const pickNew = (a) => { // 不连着说同一句
  let t = pick(a);
  for (let i = 0; i < 4 && t === lastLine && a.length > 1; i++) t = pick(a);
  return (lastLine = t);
};
const readMs = (t) => Math.min(11000, 2000 + t.length * 110); // 游戏台词长，按字数多留一会儿

let realState = 'normal';
let override = null; // 拖文件经过 / 拖动时的临时形象
let info = { working: 0, waiting: 0, five: null, week: null, tool: '' };
let dusk = null;
let lastAnchor = -1;
let act = null;      // 闲逛时主进程指挥的动作 { anim, flip, once }

const params = new URLSearchParams(location.search);
document.getElementById('seal-text').textContent = CHAR.seal;

const say = (text, ms) => (api ? api.say(text, ms) : console.log('[气泡]', text));

new SpineChar(canvas, `../../assets/models/${CHAR.key}/`).load().then((d) => {
  dusk = d;
  window.__dusk = d;
  api && api.frameSize(d.frameSize); // 主进程按统一比例设置窗口大小，角色之间体型一致
  d.onFrame = animateFx;
  // 告诉主进程各动作多长、特殊动作放不放得下，闲逛时它按这个安排节奏
  api && api.anims({
    durations: Object.fromEntries(d.data.animations.map((a) => [a.name, a.duration])),
    specialFits: d.specialFits,
  });
  render();
}).catch((e) => {
  console.error(e);
  say('模型没加载出来……', 8000);
});

// —— 特效动画：跟着小人的帧循环更新（见 pet.css 的说明） ——
const FX = {
  dots: [...fx.querySelectorAll('.d')],
  alert: fx.querySelector('.fx-alert'),
  sparks: [...fx.querySelectorAll('.sp')],
  seal: fx.querySelector('.seal'),
};
let fxState = '';
let fxSince = 0;
const wave = (phase, peak = 0.4) => { // 0→1→0 的缓动，峰值出现在 peak 处
  const v = phase < peak ? phase / peak : (1 - phase) / (1 - peak);
  return 0.5 - 0.5 * Math.cos(Math.PI * v);
};
function animateFx(t) {
  const state = fx.dataset.state;
  if (state !== fxState) { fxState = state; fxSince = t; }
  if (state === 'working') {
    FX.dots.forEach((el, i) => {
      const e = wave(((t / 1200) - i * 0.2 / 1.2 + 10) % 1);
      el.style.transform = `translateY(${-8 * e}px)`;
      el.style.opacity = 0.35 + 0.65 * e;
    });
  } else if (state === 'waiting') {
    const e = wave((t / 700) % 1);
    FX.alert.style.transform = `translateY(${-8 * e}px) rotate(${-6 * e}deg)`;
  }
  if (state === 'done' || state === 'catch') {
    FX.sparks.forEach((el, i) => {
      const e = wave(((t / 1400) - i * 0.45 / 1.4 + 10) % 1, 0.5);
      el.style.transform = `scale(${0.3 + 0.7 * e})`;
      el.style.opacity = e;
    });
  }
  if (state === 'done') { // 盖章：放大的印章落下来
    const p = Math.min(1, (t - fxSince) / 450);
    const e = 1 - Math.pow(1 - p, 3);
    FX.seal.style.transform = `scale(${2.2 - 1.2 * e})`;
    FX.seal.style.opacity = p;
  }
}

function render() {
  const state = override || realState;
  fx.dataset.state = state;
  for (const el of fx.querySelectorAll('.v')) {
    el.style.display = el.dataset.in.split(' ').includes(state) ? '' : 'none';
  }
  if (!dusk) return;
  if (state === 'roam') { playAct(); return; }
  if (state !== 'drag') dusk.flip = false;
  const anim = params.get('anim') || ANIM[state] || 'Relax';
  if (state === 'done') dusk.play('Interact', { loop: false, then: 'Relax' });
  else dusk.play(anim);
}

// 闲逛：走路、发呆、伸懒腰、特殊动作，由主进程按节奏下达
function playAct() {
  const a = act || { anim: 'Relax' };
  dusk.flip = !!a.flip;
  if (a.once) dusk.play(a.anim, { loop: false, then: 'Relax' });
  else dusk.play(a.anim);
}

// 气泡和特效要对准她：脚底中心在画布里的横向位置（0~1）
const REF_FRAME_H = 438; // 特效层按夕的取景高度设计，其他角色按同样的像素/单位缩放
function placeFx() {
  if (!dusk || dusk.originX === undefined) return;
  const fxH = (window.innerHeight * REF_FRAME_H) / dusk.frameSize.h;
  const fxW = (fxH * 240) / 250;
  fx.style.height = `${fxH}px`;
  fx.style.width = `${fxW}px`;
  fx.style.left = `${dusk.originX * window.innerWidth - 0.65 * fxW}px`; // 特效层按夕的站位设计，她的脚在 0.65 处
}
setInterval(() => {
  if (!dusk || dusk.originX === undefined) return;
  placeFx();
  const x = Math.round(dusk.originX * 100) / 100;
  if (api && x !== lastAnchor) { lastAnchor = x; api.anchor(x); }
}, 500);
window.addEventListener('resize', placeFx);

// 常态：偶尔变出小凳子坐下摸鱼
setInterval(() => {
  if (!dusk || !dusk.specialFits || override || realState !== 'normal' || dusk.current !== 'Relax') return;
  if (Math.random() < 0.35) dusk.play('Special', { loop: false, then: 'Relax' });
}, 45000);

// —— 状态更新 ——
if (api) {
  api.onPause((p) => { if (dusk) dusk.setPaused(p); });
  api.onAct((a) => {
    const fresh = JSON.stringify(a) !== JSON.stringify(act);
    act = a;
    if (realState !== 'roam' || override) return;
    if (fresh && dusk) dusk.current = null; // 同一个动作再下达一次（比如又一次伸懒腰）也要重播
    render();
    if (a && a.anim === 'Relax' && Math.random() < 0.2) say(pick(LINES.roam), 3500);
  });
  api.onState((d) => {
    const prev = realState;
    info = d;
    if (dusk) dusk.setPaused(!!d.away);
    realState = d.state;
    if (prev !== realState) {
      render();
      if (prev === 'roam') say(pick(LINES.wake));
      else if (realState === 'working' && d.tool) say(`正在用 ${d.tool}……`);
      else if (LINES[realState]) say(pick(LINES[realState]));
    }
  });
} else {
  // 浏览器预览：?state=working 或 ?anim=Sit；按 1-6 切换状态
  realState = params.get('state') || 'normal';
  const order = ['normal', 'working', 'waiting', 'done', 'roam', 'catch'];
  window.addEventListener('keydown', (e) => {
    const i = +e.key - 1;
    if (order[i]) { realState = order[i]; render(); }
  });
}
render();

// —— 鼠标：拖动 / 点她互动 / 右键菜单（工作台、打开 Claude 都在菜单里） ——
let down = null;
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
  const click = !down.moved;
  down = null;
  canvas.classList.remove('dragging');
  if (override === 'drag') { override = null; render(); }
  api && api.dragEnd();
  if (click) poke();
});

// 点她：像基建里点干员那样做个互动动作、说句话；1 秒内连着戳，第 3 下起换一套反应
const pokes = { n: 0, at: 0 };
function poke() {
  api && api.interact();
  const now = performance.now();
  pokes.n = now - pokes.at < 1000 ? pokes.n + 1 : 1;
  pokes.at = now;
  const combo = pokes.n >= 3 && pokes.n % 4 === 3; // 第 3、7、11……下
  const state = override || realState;
  if (state === 'drag' || state === 'catch') return;
  const line = pokes.n === 1 ? pickNew(LINES.poke || LINES.normal) : combo ? pickNew(LINES.combo || LINES.normal) : null;
  if (line) say(line, readMs(line));
  if (!dusk || (state === 'roam' && act && act.anim === 'Move')) return; // 走路时窗口在移动，不换动作免得滑步
  if (combo) react(state === 'normal' && dusk.specialFits ? 'Special' : 'Interact', true);
  else react('Interact', false);
}

// 播一次动作，做完回到当前状态该有的动作；上一个一次性动作没做完一半就不打断（连点时不会一直卡在第一帧）
function react(anim, force) {
  const cur = dusk.state.getCurrent(0);
  if (!force && cur && !cur.loop && cur.trackTime < cur.animation.duration * 0.5) return;
  const state = realState;
  const back = state === 'roam' ? (act && !act.once && act.anim) || 'Relax'
    : state === 'done' ? 'Relax' : params.get('anim') || ANIM[state] || 'Relax';
  dusk.current = null;
  dusk.play(anim, { loop: false, then: back });
}

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
