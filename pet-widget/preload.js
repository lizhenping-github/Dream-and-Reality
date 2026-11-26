/**
 * 预加载脚本：以安全方式向渲染进程暴露主进程能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (patch) => ipcRenderer.invoke('save-config', patch),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (e, c) => cb(c)),

  // 窗口拖动
  moveStart: (x, y) => ipcRenderer.send('win-move-start', x, y),
  move: (x, y) => ipcRenderer.send('win-move', x, y),
  moveEnd: () => ipcRenderer.send('win-move-end'),

  // 缩放
  resize: (scale) => ipcRenderer.send('win-resize', scale),

  // 其他
  choosePet: () => ipcRenderer.invoke('choose-pet'),
  openSettings: () => ipcRenderer.invoke('open-settings')
});
