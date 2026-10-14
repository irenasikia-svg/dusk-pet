const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('duskPet', {
  // 桌宠
  onState: (cb) => ipcRenderer.on('pet:state', (_e, d) => cb(d)),
  onScale: (cb) => ipcRenderer.on('pet:scale', (_e, d) => cb(d)),
  dragStart: (p) => ipcRenderer.send('pet:drag-start', p),
  dragMove: (p) => ipcRenderer.send('pet:drag-move', p),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  interact: () => ipcRenderer.send('pet:interact'),
  togglePanel: () => ipcRenderer.send('pet:toggle-panel'),
  menu: () => ipcRenderer.send('pet:menu'),
  openClaude: () => ipcRenderer.send('pet:open-claude'),
  pathsOf: (files) => Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  drop: (paths, how) => ipcRenderer.send('pet:drop', { paths, how }),
  say: (text, ms) => ipcRenderer.send('pet:say', { text, ms }),
  hideBubble: () => ipcRenderer.send('pet:hide-bubble'),
  anchor: (x) => ipcRenderer.send('pet:anchor', x),
  frameSize: (f) => ipcRenderer.send('pet:frame', f),
  // 气泡
  onBubble: (cb) => ipcRenderer.on('bubble:show', (_e, d) => cb(d)),
  bubbleSize: (s) => ipcRenderer.send('bubble:size', s),
  bubbleChoose: (how) => ipcRenderer.send('bubble:choose', how),
  // 面板
  onPanelData: (cb) => ipcRenderer.on('panel:data', (_e, d) => cb(d)),
  closePanel: () => ipcRenderer.send('panel:close'),
  panelAction: (a) => ipcRenderer.send('panel:action', a),
  openPath: (p) => ipcRenderer.send('panel:open-path', p),
});
