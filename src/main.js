// 夕 · Claude 桌宠 —— 主进程
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, powerMonitor, Notification } = require('electron');
const { Monitor } = require('./monitor');
const actions = require('./actions');
const hooks = require('../scripts/hooks');

const DATA_DIR = path.join(os.homedir(), '.claude', 'dusk-pet');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PET_W = 120;   // 基础尺寸（倍率 1）
const PET_H = 125;
const AGENT_LABEL = 'local.dusk-pet';
const AGENT_FILE = path.join(os.homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);

const DEFAULTS = {
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
let previewState = null;     // 右键菜单里手动预览的形象
let lastInteraction = Date.now();
let lastSnapshot = null;
let lastOverall = 'idle';
let anchorX = 0.6;           // 她脚底中心在窗口里的横向位置，气泡对准这里
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
  return c;
}
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

function createPet() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = Math.round(PET_W * config.scale);
  const h = Math.round(PET_H * config.scale);
  const x = config.x ?? workArea.x + workArea.width - w - 32;
  const y = config.y ?? workArea.y + workArea.height - h;
  pet = new BrowserWindow({
    width: w, height: h, x, y,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: config.alwaysOnTop, skipTaskbar: true, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: PRELOAD,
  });
  pet.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pet.loadFile(path.join(__dirname, 'renderer', 'pet.html'), { query: { scale: String(config.scale) } });
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
  if (sysIdle >= config.idleSeconds || quiet >= config.napAfterQuietMinutes) return 'sleep';
  return 'normal';
}

function decorate(snap) {
  return {
    ...snap,
    state: petState(snap),
    systemIdle: powerMonitor.getSystemIdleTime(),
    hooksInstalled: hooks.isInstalled(),
    config,
  };
}

async function tick() {
  try {
    const snap = await monitor.tick(powerMonitor.getSystemIdleTime(), config);
    lastSnapshot = snap;
    const data = decorate(snap);
    if (pet && !pet.isDestroyed()) pet.webContents.send('pet:state', {
      state: data.state,
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
      new Notification({ title: '夕：这一步要你点头', body: s ? `${s.title}${s.hookMsg ? ' · ' + s.hookMsg : ''}` : 'Claude 在等你确认', silent: false }).show();
    }
    lastOverall = snap.overall;
  } catch (e) {
    console.error('tick failed', e);
  }
}

// —— 菜单 ——
const STATE_LABEL = { normal: '常态', working: '处理中', waiting: '等你确认', done: '完成', sleep: '睡觉', catch: '接文件' };
const TRAY_GLYPH = { normal: '', working: ' ✎', waiting: ' !', done: ' ✓', sleep: ' z', catch: '' };

function updateTray(state) {
  if (tray) tray.setTitle(`夕${TRAY_GLYPH[state] || ''}`);
}

function buildMenu() {
  const installed = hooks.isInstalled();
  return Menu.buildFromTemplate([
    { label: '打开工作台（会话 · 进程 · 用量）', click: () => togglePanel(true) },
    { label: '新建 Claude Code 会话', click: () => actions.newCodeSession() },
    { label: '继续最近的会话', click: () => actions.openClaudeApp() },
    { type: 'separator' },
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
        ...['normal', 'working', 'waiting', 'done', 'sleep'].map((s) => ({
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
      label: '多久不操作后睡觉',
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
    { label: '退出夕', role: 'quit' },
  ]);
}

function setScale(v) {
  config.scale = v;
  const b = pet.getBounds();
  const w = Math.round(PET_W * v);
  const h = Math.round(PET_H * v);
  const x = Math.round(b.x + b.width / 2 - w / 2);
  const y = b.y + b.height - h;
  pet.setBounds({ x, y, width: w, height: h });
  config.x = x; config.y = y;
  saveConfig();
  pet.webContents.send('pet:scale', v);
  placeBubble();
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
ipcMain.on('pet:drag-start', (_e, p) => { dragOrigin = { mouse: p, win: pet.getPosition() }; lastInteraction = Date.now(); });
ipcMain.on('pet:drag-move', (_e, p) => {
  if (!dragOrigin) return;
  pet.setPosition(Math.round(dragOrigin.win[0] + p.x - dragOrigin.mouse.x), Math.round(dragOrigin.win[1] + p.y - dragOrigin.mouse.y));
  if (bubble.isVisible()) placeBubble();
});
ipcMain.on('pet:drag-end', () => {
  dragOrigin = null;
  const [x, y] = pet.getPosition();
  config.x = x; config.y = y; saveConfig();
});
ipcMain.on('pet:interact', () => { lastInteraction = Date.now(); });
ipcMain.on('pet:toggle-panel', () => togglePanel());
ipcMain.on('pet:menu', () => buildMenu().popup({ window: pet }));
ipcMain.on('pet:open-claude', () => actions.openClaudeApp());
ipcMain.on('pet:say', (_e, { text, ms }) => say(text, ms));
ipcMain.on('pet:hide-bubble', () => { if (!pendingPaths) hideBubble(); });
ipcMain.on('pet:anchor', (_e, x) => { anchorX = x; if (bubble.isVisible()) placeBubble(); });
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
  tray.setTitle('夕');
  tray.setToolTip('夕 · Claude 桌宠');
  tray.on('click', () => togglePanel());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  tick();
  setInterval(tick, 1500);
  if (process.env.DUSK_DEBUG_DIR) debugCapture(process.env.DUSK_DEBUG_DIR);
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
