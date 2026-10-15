// 夕 · Claude 桌宠 —— 主进程
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, powerMonitor, Notification } = require('electron');
const { Monitor } = require('./monitor');
const actions = require('./actions');
const hooks = require('../scripts/hooks');
const { CHARACTERS, byKey } = require('./characters');

const DATA_DIR = path.join(os.homedir(), '.claude', 'dusk-pet');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PET_W = 120;   // 基础尺寸（倍率 1，按夕的取景）
const PET_H = 125;
// 所有基建小人用同一个「像素/模型单位」：夕的取景高 438 单位 ↔ 125 像素。
// 带高装饰的角色窗口会更高，而不是把人缩小。
const REF_UNITS = 438;
const DEFAULT_FRAME = { w: 428, h: 438 };
const AGENT_LABEL = 'local.dusk-pet';
const AGENT_FILE = path.join(os.homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);

const DEFAULTS = {
  character: 'dusk',
  scale: 1,
  alwaysOnTop: true,
  autoStart: true,
  idleSeconds: 180,          // 系统无键鼠操作多久后夕会睡着
  napAfterQuietMinutes: 20,  // Claude 和夕都没人理多久后也会睡着
  dropAction: 'ask',         // ask | new | current | terminal
  newTarget: 'code',         // code | cowork
  notify: true,
};

let config = loadConfig();
let pet = null;
let panel = null;
let bubble = null;
let tray = null;
let previewState = process.env.DUSK_DEBUG_STATE || null; // 右键菜单里手动预览的形象（调试时可用环境变量指定）
let lastInteraction = Date.now();
let lastSnapshot = null;
let lastOverall = 'idle';
let anchorX = 0.6;
let petFrame = DEFAULT_FRAME; // 当前角色的取景尺寸（模型单位），模型加载后由渲染进程报告           // 她脚底中心在窗口里的横向位置，气泡对准这里
let bubbleTimer = null;
let bubbleSize = null;
let pendingPaths = null;     // 拖进来、正在等你选怎么处理的文件
const monitor = new Monitor();

function loadConfig() {
  let c;
  try { c = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
  if (!c.layout2 && c.x != null) {
    // 旧版窗口 240×300：换成新尺寸时保持她站的位置不变（底部居中对齐）
    c.x = Math.round(c.x + ((240 - PET_W) * c.scale) / 2);
    c.y = Math.round(c.y + (300 - PET_H) * c.scale);
  }
  c.layout2 = true;
  if (c.cx == null && c.x != null) {
    // 位置改存「脚下中点」：换角色时窗口宽度会变，存左上角会让她慢慢漂移
    c.cx = Math.round(c.x + (PET_W * c.scale) / 2);
    c.bottom = Math.round(c.y + PET_H * c.scale);
  }
  delete c.x; delete c.y;
  delete c.aspects;
  c.frames = c.frames || {};
  return c;
}
const CHAR = () => byKey(config.character);

function saveConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// —— 开机自启：~/Library/LaunchAgents 里的登录项 ——
function xml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function agentPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(app.getAppPath())}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
}
function syncAutoStart() {
  try {
    if (config.autoStart) {
      const want = agentPlist();
      const have = fs.existsSync(AGENT_FILE) ? fs.readFileSync(AGENT_FILE, 'utf8') : '';
      if (have !== want) {
        fs.mkdirSync(path.dirname(AGENT_FILE), { recursive: true });
        fs.writeFileSync(AGENT_FILE, want);
      }
    } else {
      fs.rmSync(AGENT_FILE, { force: true });
    }
  } catch (e) {
    console.error('auto start', e);
  }
}

// —— 窗口 ——
const PRELOAD = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };

function petQuery() {
  return { query: { scale: String(config.scale), char: CHAR().key } };
}

function petBoundsAt(cx, bottom) {
  const k = (PET_H * config.scale) / REF_UNITS;
  const w = Math.round(Math.min(petFrame.w, REF_UNITS * 2) * k);
  const h = Math.round(Math.min(petFrame.h, REF_UNITS * 2) * k);
  return { x: Math.round(cx - w / 2), y: Math.round(bottom - h), width: w, height: h };
}

function rememberPosition() {
  const b = pet.getBounds();
  config.cx = b.x + b.width / 2;
  config.bottom = b.y + b.height;
  saveConfig();
}

// 保持她脚下的位置（窗口底边中点）不动，改窗口尺寸
function resizePet() {
  stopRoamNow();
  const b = pet.getBounds();
  pet.setBounds(petBoundsAt(b.x + b.width / 2, b.y + b.height));
  rememberPosition();
  placeBubble();
}

function switchCharacter(key) {
  if (key === config.character) return;
  stopRoamNow();
  config.character = key;
  saveConfig();
  hideBubble();
  if (config.frames[key]) { petFrame = config.frames[key]; resizePet(); }
  pet.loadFile(path.join(__dirname, 'renderer', 'pet.html'), petQuery());
  updateTray(lastSnapshot ? decorate(lastSnapshot).state : 'normal');
  if (panel && panel.isVisible() && lastSnapshot) panel.webContents.send('panel:data', decorate(lastSnapshot));
}

function createPet() {
  const { workArea } = screen.getPrimaryDisplay();
  petFrame = config.frames[CHAR().key] || DEFAULT_FRAME;
  const { x, y, width: w, height: h } = petBoundsAt(
    config.cx ?? workArea.x + workArea.width - 32 - PET_W / 2,
    config.bottom ?? workArea.y + workArea.height,
  );
  pet = new BrowserWindow({
    width: w, height: h, x, y,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: config.alwaysOnTop, skipTaskbar: true, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: PRELOAD,
  });
  pet.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pet.loadFile(path.join(__dirname, 'renderer', 'pet.html'), petQuery());
  // 调试：对桌宠页做 10 秒 CPU 采样，按函数汇总耗时，写进 DUSK_DEBUG_DIR/profile.json
  if (process.env.DUSK_DEBUG_PROFILE && process.env.DUSK_DEBUG_DIR) {
    pet.webContents.once('did-finish-load', () => setTimeout(async () => {
      const dbg = pet.webContents.debugger;
      try {
        dbg.attach('1.3');
        await dbg.sendCommand('Profiler.enable');
        await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 });
        await dbg.sendCommand('Profiler.start');
        await new Promise((r) => setTimeout(r, 10000));
        const { profile } = await dbg.sendCommand('Profiler.stop');
        const self = {};
        const total = profile.samples.length;
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const counts = {};
        for (const id of profile.samples) counts[id] = (counts[id] || 0) + 1;
        for (const [id, c] of Object.entries(counts)) {
          const n = byId.get(+id).callFrame;
          const key = `${n.functionName || '(anonymous)'} ${n.url.split('/').pop()}:${n.lineNumber}`;
          self[key] = (self[key] || 0) + c;
        }
        const top = Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, +(100 * v / total).toFixed(1)]);
        fs.writeFileSync(path.join(process.env.DUSK_DEBUG_DIR, 'profile.json'), JSON.stringify({ total, top }, null, 1));
        dbg.detach();
      } catch (e) {
        fs.writeFileSync(path.join(process.env.DUSK_DEBUG_DIR, 'profile.json'), JSON.stringify({ error: String(e) }));
      }
    }, 3000));
  }
  // 调试：页面加载 3 秒后在桌宠页里执行一段脚本（性能排查用），结果写进 DUSK_DEBUG_DIR
  if (process.env.DUSK_DEBUG_EXEC) {
    pet.webContents.once('did-finish-load', () => setTimeout(async () => {
      let out;
      try { out = await pet.webContents.executeJavaScript(process.env.DUSK_DEBUG_EXEC); } catch (e) { out = String(e); }
      if (process.env.DUSK_DEBUG_DIR) fs.writeFileSync(path.join(process.env.DUSK_DEBUG_DIR, 'exec.json'), JSON.stringify(out));
    }, 3000));
  }
}

function createBubble() {
  // 原生毛玻璃（和 macOS 弹出层同一种材质），能真正透出并模糊桌面
  bubble = new BrowserWindow({
    width: 160, height: 36, show: false,
    frame: false, resizable: false, movable: false, focusable: false, hasShadow: true,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, acceptFirstMouse: true,
    vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true,
    backgroundColor: '#00000000',
    webPreferences: { ...PRELOAD, backgroundThrottling: false },
  });
  bubble.setAlwaysOnTop(true, 'pop-up-menu');
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubble.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
}

function createPanel() {
  panel = new BrowserWindow({
    width: 380, height: 600, show: false,
    transparent: true, frame: false, resizable: false, hasShadow: true,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: PRELOAD,
  });
  panel.setAlwaysOnTop(true, 'floating');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panel.on('blur', () => { if (!panel.webContents.isDevToolsOpened()) panel.hide(); });
}

function togglePanel(force) {
  if (!panel) return;
  const show = force ?? !panel.isVisible();
  if (!show) { panel.hide(); return; }
  const pb = pet.getBounds();
  const disp = screen.getDisplayMatching(pb).workArea;
  const [pw, ph] = panel.getSize();
  let x = pb.x - pw + 4;
  if (x < disp.x) x = pb.x + pb.width - 4;
  const y = Math.min(Math.max(pb.y + pb.height - ph, disp.y), disp.y + disp.height - ph);
  panel.setPosition(Math.round(x), Math.round(y));
  if (lastSnapshot) panel.webContents.send('panel:data', decorate(lastSnapshot));
  panel.show();
  panel.focus();
  tick({ heavy: true }); // 打开时马上刷新会话、进程和用量
}

// —— 气泡 ——
function say(text, ms = 3200, menu = false) {
  if (!bubble || bubble.isDestroyed()) return;
  if (pendingPaths && !menu) return; // 正在问你怎么处理文件时不打断
  bubble.webContents.send('bubble:show', { text, menu });
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  pendingPaths = null;
  if (bubble && bubble.isVisible()) bubble.hide();
}

function placeBubble() {
  if (!bubbleSize || !pet) return;
  const { w, h } = bubbleSize;
  const pb = pet.getBounds();
  const disp = screen.getDisplayMatching(pb).workArea;
  let x = pb.x + pb.width * anchorX - w / 2;
  let y = pb.y - h + 2 * config.scale;
  if (y < disp.y) y = pb.y + pb.height + 4; // 头顶没地方就放到脚下
  x = Math.min(Math.max(x, disp.x + 4), disp.x + disp.width - w - 4);
  bubble.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
}

function resultText(how, r) {
  if (r && r.ok) return how === 'current' ? '贴进当前对话了。' : how === 'terminal' ? '在终端里开好了。' : '新对话开好了，去看看。';
  if (r && r.denied) return '先在「辅助功能」里允许我，才能帮你粘贴。';
  return `没送到……${((r && r.error) || '').slice(0, 30)}`;
}

// —— 状态决策 ——
function petState(snap) {
  if (previewState) return previewState;
  if (snap.overall !== 'idle') return snap.overall;
  const now = Date.now();
  const sysIdle = powerMonitor.getSystemIdleTime();
  const quiet = (now - Math.max(snap.lastClaudeActivity, lastInteraction)) / 60000;
  if (sysIdle >= config.idleSeconds || quiet >= config.napAfterQuietMinutes) return 'roam';
  return 'normal';
}

// —— 闲逛：长时间不操作时，在原位附近走走停停，停下时随机发呆 / 伸懒腰 / 特殊动作 ——
const ROAM_SPEED = 26;   // 走路速度：像素/秒（倍率 1）
const ROAM_RANGE = 240;  // 离原位最远多少像素（倍率 1）
let roam = null;         // { home, timer, walk, returning }
let petAnims = { durations: {}, specialFits: false };
const rand = (n) => Math.random() * n;

function petCenter() {
  const b = pet.getBounds();
  return b.x + b.width / 2;
}

function sendAct(act) {
  if (pet && !pet.isDestroyed()) pet.webContents.send('pet:act', act);
}

function clearRoamTimers() {
  if (!roam) return;
  clearTimeout(roam.timer);
  clearInterval(roam.walk);
  roam.timer = null;
  roam.walk = null;
}

function startRoam() {
  if (roam && !roam.returning) return;
  if (roam && roam.returning) { // 往回走到一半又没人理了：接着逛
    clearRoamTimers();
    roam.returning = false;
    roamPause();
    return;
  }
  roam = { home: config.cx ?? petCenter(), timer: null, walk: null, returning: false };
  roamPause(2000 + rand(3000));
}

function roamNext() {
  if (!roam || roam.returning) return;
  if (Math.random() < 0.55) roamWalk(); else roamAct();
}

function roamPause(ms) {
  sendAct({ anim: 'Relax', flip: roam.flip });
  roam.timer = setTimeout(roamNext, ms ?? 3000 + rand(5000));
}

function roamAct() {
  const options = [['Relax', 0.5], ['Interact', 0.25]];
  if (petAnims.specialFits) options.push(['Special', 0.25]);
  let r = rand(options.reduce((a, [, w]) => a + w, 0));
  const [anim] = options.find(([, w]) => (r -= w) < 0) || options[0];
  if (anim === 'Relax') {
    sendAct({ anim: 'Relax', flip: roam.flip });
    roam.timer = setTimeout(roamNext, 6000 + rand(7000));
  } else {
    sendAct({ anim, once: true, flip: roam.flip });
    roam.timer = setTimeout(roamNext, (petAnims.durations[anim] || 3) * 1000 + 1500 + rand(3000));
  }
}

function roamWalk(targetCx, speed, onArrive) {
  const b = pet.getBounds();
  const disp = screen.getDisplayMatching(b).workArea;
  const s = config.scale;
  let target = targetCx;
  if (target == null) {
    const lo = Math.max(roam.home - ROAM_RANGE * s, disp.x + b.width / 2);
    const hi = Math.min(roam.home + ROAM_RANGE * s, disp.x + disp.width - b.width / 2);
    const cur = petCenter();
    for (let i = 0; i < 6; i++) {
      target = lo + rand(Math.max(0, hi - lo));
      if (Math.abs(target - cur) > 50 * s) break;
    }
  }
  let x = petCenter();
  const dir = Math.sign(target - x) || 1;
  roam.flip = dir < 0; // 模型默认朝右，往左走要翻过来；停下来也保持朝向
  sendAct({ anim: 'Move', flip: roam.flip });
  const v = (speed || ROAM_SPEED) * s;
  const stepMs = 1000 / 20;
  const walk = setInterval(() => {
    if (!roam || roam.walk !== walk) { clearInterval(walk); return; }
    x += (dir * v * stepMs) / 1000;
    const arrived = dir > 0 ? x >= target : x <= target;
    if (arrived) x = target;
    const bb = pet.getBounds();
    pet.setPosition(Math.round(x - bb.width / 2), bb.y);
    if (bubble.isVisible()) placeBubble();
    if (arrived) {
      clearInterval(walk);
      roam.walk = null;
      (onArrive || (() => roamPause()))();
    }
  }, stepMs);
  roam.walk = walk;
}

// 你回来了：走回原位，再把控制权交还给正常状态
function endRoam() {
  if (!roam || roam.returning) return;
  clearRoamTimers();
  roam.returning = true;
  if (Math.abs(petCenter() - roam.home) < 3) { finishRoam(); return; }
  roamWalk(roam.home, ROAM_SPEED * 3, finishRoam);
}

function finishRoam() {
  if (!roam) return;
  clearRoamTimers();
  roam = null;
  sendAct(null);
  tick();
}

// 换角色、改大小、开始拖动时：立刻停下（需要时瞬间回到原位）
function stopRoamNow(snapHome = true) {
  if (!roam) return;
  clearRoamTimers();
  const home = roam.home;
  roam = null;
  if (snapHome && pet && !pet.isDestroyed()) {
    const b = pet.getBounds();
    pet.setPosition(Math.round(home - b.width / 2), b.y);
  }
  sendAct(null);
}

let hooksCache = { at: 0, value: false };
function hooksInstalled() {
  if (Date.now() - hooksCache.at > 30000) hooksCache = { at: Date.now(), value: hooks.isInstalled() };
  return hooksCache.value;
}

function decorate(snap) {
  return {
    ...snap,
    state: roam ? 'roam' : petState(snap), // 往回走的路上也还算在闲逛
    systemIdle: powerMonitor.getSystemIdleTime(),
    hooksInstalled: hooksInstalled(),
    character: { key: CHAR().key, name: CHAR().name, seal: CHAR().seal, skin: CHAR().skin },
    config,
  };
}

// —— 刷新节奏 ——
const TICK_MS = 2000;            // 平时：只做便宜的状态检查
const TICK_AWAY_MS = 10000;      // 你离开时
const HEAVY_MS = 60000;          // 后台的完整刷新（列进程、算用量）
const HEAVY_PANEL_MS = 3000;     // 面板开着时的完整刷新
const AWAY_SECONDS = 600;        // 键鼠 10 分钟没动或锁屏 → 离开模式：动画、闲逛、对话检测全部暂停
let away = false;
let screenLocked = false;
let tickTimer = null;
let ticking = false;

function setAway(on) {
  if (away === on) return;
  away = on;
  if (on) stopRoamNow();
  monitor.pause(on);
  if (pet && !pet.isDestroyed()) pet.webContents.send('pet:pause', on);
}

function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(() => tick(), away ? TICK_AWAY_MS : TICK_MS);
}

async function tick({ heavy = false } = {}) {
  if (ticking) return;
  ticking = true;
  try {
    const sysIdle = powerMonitor.getSystemIdleTime();
    setAway(screenLocked || sysIdle >= AWAY_SECONDS || !!process.env.DUSK_DEBUG_AWAY);
    const since = Date.now() - monitor.lastHeavy;
    const panelOpen = panel && panel.isVisible();
    const doHeavy = heavy || since >= HEAVY_MS || (panelOpen && since >= HEAVY_PANEL_MS);
    const snap = await monitor.tick(sysIdle, config, { heavy: doHeavy && !away });
    lastSnapshot = snap;
    if (!away && petState(snap) === 'roam') startRoam();
    else if (roam) endRoam();
    const data = decorate(snap);
    if (pet && !pet.isDestroyed()) pet.webContents.send('pet:state', {
      state: data.state,
      away, // 页面加载晚于第一次判定时，靠这个补上暂停状态
      working: snap.sessions.filter((s) => s.status === 'working').length,
      waiting: snap.sessions.filter((s) => s.status === 'waiting').length,
      five: snap.plan.five,
      week: snap.plan.week,
      tool: (snap.sessions.find((s) => s.status === 'working') || {}).tool || '',
    });
    if (panel && panel.isVisible()) panel.webContents.send('panel:data', data);
    updateTray(data.state);
    if (config.notify && snap.overall === 'waiting' && lastOverall !== 'waiting' && Notification.isSupported()) {
      const s = snap.sessions.find((x) => x.status === 'waiting');
      new Notification({ title: `${CHAR().name}：这一步要你点头`, body: s ? `${s.title}${s.hookMsg ? ' · ' + s.hookMsg : ''}` : 'Claude 在等你确认', silent: false }).show();
    }
    lastOverall = snap.overall;
  } catch (e) {
    console.error('tick failed', e);
  } finally {
    ticking = false;
    scheduleTick();
  }
}

// —— 菜单 ——
const STATE_LABEL = { normal: '常态', working: '处理中', waiting: '等你确认', done: '完成', roam: '闲逛', catch: '接文件' };
const TRAY_GLYPH = { normal: '', working: ' ✎', waiting: ' !', done: ' ✓', roam: ' ~', catch: '' };

function updateTray(state) {
  if (tray) tray.setTitle(`${CHAR().seal}${TRAY_GLYPH[state] || ''}`);
}

function buildMenu() {
  const installed = hooks.isInstalled();
  return Menu.buildFromTemplate([
    { label: '打开工作台（会话 · 进程 · 用量）', click: () => togglePanel(true) },
    { label: '新建 Claude Code 会话', click: () => actions.newCodeSession() },
    { label: '继续最近的会话', click: () => actions.openClaudeApp() },
    { type: 'separator' },
    {
      label: '换角色',
      submenu: CHARACTERS.map((c) => ({
        label: `${c.name} · ${c.skin}`, type: 'radio', checked: config.character === c.key, click: () => switchCharacter(c.key),
      })),
    },
    {
      label: '拖入文件时',
      submenu: [
        ['ask', '每次询问'], ['new', '新开对话'], ['current', '加到当前对话'], ['terminal', '终端里开 CLI 会话'],
      ].map(([v, l]) => ({ label: l, type: 'radio', checked: config.dropAction === v, click: () => { config.dropAction = v; saveConfig(); } })),
    },
    {
      label: '新对话打开在',
      submenu: [['code', 'Claude Code'], ['cowork', 'Cowork']].map(([v, l]) => ({
        label: l, type: 'radio', checked: config.newTarget === v, click: () => { config.newTarget = v; saveConfig(); },
      })),
    },
    {
      label: '预览形象',
      submenu: [
        { label: '自动（跟随 Claude）', type: 'radio', checked: !previewState, click: () => { previewState = null; tick(); } },
        ...['normal', 'working', 'waiting', 'done', 'roam'].map((s) => ({
          label: STATE_LABEL[s], type: 'radio', checked: previewState === s, click: () => { previewState = s; tick(); },
        })),
      ],
    },
    {
      label: '大小',
      submenu: [[0.8, '小'], [1, '中（默认）'], [1.4, '大'], [2, '特大']].map(([v, l]) => ({
        label: l, type: 'radio', checked: config.scale === v, click: () => setScale(v),
      })),
    },
    {
      label: '多久不操作后去闲逛',
      submenu: [[60, '1 分钟'], [180, '3 分钟'], [600, '10 分钟'], [1800, '30 分钟']].map(([v, l]) => ({
        label: l, type: 'radio', checked: config.idleSeconds === v, click: () => { config.idleSeconds = v; saveConfig(); },
      })),
    },
    { label: '始终置顶', type: 'checkbox', checked: config.alwaysOnTop, click: (i) => { config.alwaysOnTop = i.checked; pet.setAlwaysOnTop(i.checked, 'floating'); saveConfig(); } },
    { label: '需要确认时发通知', type: 'checkbox', checked: config.notify, click: (i) => { config.notify = i.checked; saveConfig(); } },
    { label: '开机自动启动', type: 'checkbox', checked: config.autoStart, click: (i) => { config.autoStart = i.checked; saveConfig(); syncAutoStart(); } },
    { type: 'separator' },
    installed
      ? { label: '✓ 状态钩子已安装（点击卸载）', click: () => { hooks.uninstall(); } }
      : { label: '安装 Claude Code 状态钩子（更准）', click: () => { hooks.install(); } },
    { type: 'separator' },
    { label: `退出${CHAR().name}`, role: 'quit' },
  ]);
}

function setScale(v) {
  config.scale = v;
  resizePet();
}

// —— 文件投递 ——
async function deliver(paths, how) {
  paths = paths.filter(Boolean);
  if (!paths.length) return { ok: false, error: '没拿到文件路径' };
  if (how === 'new') return actions.openNewSession(paths, config.newTarget);
  if (how === 'terminal') return actions.openInTerminal(paths);
  if (how === 'current') {
    const r = await actions.addToCurrentChat(paths);
    if (!r.ok && r.denied) actions.openAccessibilitySettings();
    return r;
  }
  return { ok: false, error: `unknown action ${how}` };
}

// —— IPC ——
let dragOrigin = null;
ipcMain.on('pet:drag-start', (_e, p) => {
  stopRoamNow(false); // 你拖到哪，她就把哪当新家
  dragOrigin = { mouse: p, win: pet.getPosition() };
  lastInteraction = Date.now();
});
ipcMain.on('pet:anims', (_e, a) => { if (a && a.durations) petAnims = a; });
ipcMain.on('pet:drag-move', (_e, p) => {
  if (!dragOrigin) return;
  pet.setPosition(Math.round(dragOrigin.win[0] + p.x - dragOrigin.mouse.x), Math.round(dragOrigin.win[1] + p.y - dragOrigin.mouse.y));
  if (bubble.isVisible()) placeBubble();
});
ipcMain.on('pet:drag-end', () => {
  dragOrigin = null;
  rememberPosition();
});
ipcMain.on('pet:interact', () => { lastInteraction = Date.now(); });
ipcMain.on('pet:toggle-panel', () => togglePanel());
ipcMain.on('pet:menu', () => buildMenu().popup({ window: pet }));
ipcMain.on('pet:open-claude', () => actions.openClaudeApp());
ipcMain.on('pet:say', (_e, { text, ms }) => say(text, ms));
ipcMain.on('pet:hide-bubble', () => { if (!pendingPaths) hideBubble(); });
ipcMain.on('pet:anchor', (_e, x) => { anchorX = x; if (bubble.isVisible()) placeBubble(); });
ipcMain.on('pet:frame', (_e, f) => {
  if (!f || !(f.w > 0) || !(f.h > 0)) return;
  const next = { w: Math.round(f.w), h: Math.round(f.h) };
  config.frames[CHAR().key] = next;
  if (next.w === petFrame.w && next.h === petFrame.h) { saveConfig(); return; }
  petFrame = next;
  resizePet();
});
ipcMain.on('pet:drop', async (_e, { paths, how }) => {
  lastInteraction = Date.now();
  how = how === 'default' ? config.dropAction : how;
  if (how === 'ask') {
    hideBubble();
    pendingPaths = paths;
    const names = paths.map((p) => path.basename(p));
    say(names.length === 1 ? `「${names[0]}」怎么处理？` : `${names.length} 个文件，怎么处理？`, 15000, true);
    return;
  }
  say(resultText(how, await deliver(paths, how)), 4000);
});
ipcMain.on('bubble:size', (_e, s) => {
  bubbleSize = s;
  placeBubble();
  if (!bubble.isVisible()) bubble.showInactive();
});
ipcMain.on('bubble:choose', async (_e, how) => {
  if (process.env.DUSK_DEBUG_DIR) fs.writeFileSync(path.join(process.env.DUSK_DEBUG_DIR, 'chosen.txt'), how);
  const paths = pendingPaths;
  pendingPaths = null;
  if (how === 'cancel' || !paths) { hideBubble(); return; }
  say(resultText(how, await deliver(paths, how)), 4000);
});
ipcMain.on('panel:close', () => togglePanel(false));
ipcMain.on('panel:action', (_e, a) => {
  if (a === 'new') actions.newCodeSession();
  else if (a === 'continue') actions.openClaudeApp();
  else if (a === 'install-hooks') { hooks.install(); tick(); }
  else if (a === 'accessibility') actions.openAccessibilitySettings();
  else if (a === 'menu') buildMenu().popup({ window: panel });
});

// —— 启动 ——
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  saveConfig();
  syncAutoStart();
  createPet();
  createBubble();
  createPanel();
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(CHAR().seal);
  tray.setToolTip('Claude 桌宠');
  tray.on('click', () => togglePanel());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  tick();
  powerMonitor.on('lock-screen', () => { screenLocked = true; tick(); });
  powerMonitor.on('unlock-screen', () => { screenLocked = false; tick(); });
  powerMonitor.on('suspend', () => { screenLocked = true; tick(); });
  powerMonitor.on('resume', () => { screenLocked = false; tick(); });
  if (process.env.DUSK_DEBUG_DIR) debugCapture(process.env.DUSK_DEBUG_DIR);
  if (process.env.DUSK_DEBUG_DIR) setTimeout(() => fs.writeFileSync(path.join(process.env.DUSK_DEBUG_DIR, 'pids.json'), JSON.stringify({
    pet: pet.webContents.getOSProcessId(), bubble: bubble.webContents.getOSProcessId(), panel: panel.webContents.getOSProcessId(),
  })), 4000);
});

// 调试：截图并记录窗口位置，写到指定目录
async function debugCapture(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(5000);
  say('正在落笔……墨未干，莫催。', 8000);
  await wait(1200);
  fs.writeFileSync(path.join(dir, 'pet.png'), (await pet.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(dir, 'bubble.png'), (await bubble.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(dir, 'windows.json'), JSON.stringify({
    bubbleUrl: bubble.webContents.getURL(), bubbleOpacity: bubble.getOpacity(), bubbleSize,
    pet: pet.getBounds(), bubble: bubble.getBounds(), bubbleVisible: bubble.isVisible(), anchorX,
    autoStart: fs.existsSync(AGENT_FILE),
  }, null, 2));
  togglePanel(true);
  await wait(1500);
  fs.writeFileSync(path.join(dir, 'panel.png'), (await panel.webContents.capturePage()).toPNG());
  if (process.env.DUSK_DEBUG_STATE === 'roam') {
    // 记录 30 秒内的窗口位置和几张截图，检查走路和停顿
    const track = [];
    for (let i = 0; i < 60; i++) {
      if (i === 40) { previewState = null; lastInteraction = Date.now(); tick(); } // 20 秒后模拟你回来了
      track.push({ t: i / 2, cx: Math.round(petCenter()), act: roam ? (roam.returning ? 'return' : roam.walk ? 'walk' : 'pause') : 'none' });
      if (i % 12 === 6) fs.writeFileSync(path.join(dir, `roam-${i}.png`), (await pet.webContents.capturePage()).toPNG());
      await wait(500);
    }
    fs.writeFileSync(path.join(dir, 'roam.json'), JSON.stringify({ home: roam && roam.home, track }));
  }
  if (process.env.DUSK_DEBUG_MENU) {
    hideBubble();
    pendingPaths = ['/tmp/示例文件.pdf'];
    say('「示例文件.pdf」怎么处理？', 90000, true);
    await wait(800);
    fs.writeFileSync(path.join(dir, 'menu.png'), (await bubble.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(bubble.getBounds()));
  }
}

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => monitor.stop());
