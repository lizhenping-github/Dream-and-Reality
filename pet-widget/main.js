/**
 * 桌面宠物下班倒计时小组件 - 主进程
 * 功能：透明无边框置顶窗口、手动拖动/缩放 IPC、托盘菜单、配置持久化
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// 设计基准尺寸（悬浮窗内容 + 透明边距），缩放时按此换算窗口大小
const BASE_W = 432;
const BASE_H = 252;

// 默认配置
const DEFAULTS = {
  widgetName: '下班倒计时',        // 组件名称（托盘提示用）
  workdays: [1, 2, 3, 4, 5],       // 工作日：1=周一 ... 7=周日
  workStart: '09:00',              // 上班时间
  workEnd: '18:00',                // 下班时间
  fontColor: '#262626',            // 字体颜色
  bgColor: '#f7f7f8',              // 背景颜色
  payday: 10,                      // 发薪日：每月 X 日
  dailyIncome: 500,                // 每日收入（元）
  petName: '橘座',                 // 宠物名称
  petPreset: 'cat1',               // 内置宠物 id
  petPath: '',                     // 自定义宠物图片路径（支持 gif）
  scale: 1,                        // 缩放倍率 0.5 ~ 2.5
  bubbleEnabled: true,             // 是否开启气泡语录
  clickThrough: false,             // 鼠标穿透
  pinMode: 'top',                  // 钉扎模式：'top' 置顶 / 'desktop' 嵌入桌面层
  autoStart: false,                // 开机自启
  pos: null                        // 窗口位置 {x,y}
};

let win = null;           // 悬浮窗
let settingsWin = null;   // 设置窗口
let tray = null;          // 托盘
let cfg = null;           // 当前配置
let dragCtx = null;       // 拖动上下文
let embedded = false;     // 当前是否已嵌入桌面层

// [临时诊断] 捕获主进程未处理异常并记录后按默认行为退出
process.on('uncaughtException', (e) => {
  try {
    fs.appendFileSync(path.join(__dirname, '_exit_log.txt'),
      new Date().toISOString() + ' uncaughtException ' + (e.stack || e.message) + '\n');
  } catch { }
  process.exit(1);
});

// [临时诊断] 记录退出原因
function logExit(reason) {
  try {
    fs.appendFileSync(path.join(__dirname, '_exit_log.txt'),
      new Date().toISOString() + ' ' + reason + '\n');
  } catch { }
}

// 配置文件路径（存放在系统 userData 目录）
function cfgFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

// 读取配置（失败则用默认值）
function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

// 写入配置
function saveConfig() {
  try {
    fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

// 根据缩放倍率计算窗口尺寸
function winSize(scale) {
  return { w: Math.round(BASE_W * scale), h: Math.round(BASE_H * scale) };
}

// 向悬浮窗广播最新配置
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('config-updated', cfg);
  refreshTray();
}

// 创建透明悬浮窗
function createWindow() {
  const { w, h } = winSize(cfg.scale);
  win = new BrowserWindow({
    width: w,
    height: h,
    x: cfg.pos ? cfg.pos.x : undefined,
    y: cfg.pos ? cfg.pos.y : undefined,
    frame: false,            // 无边框
    transparent: true,       // 透明背景
    hasShadow: false,        // 关闭系统阴影（用 CSS 阴影）
    resizable: false,        // 尺寸由我们手动管理
    fullscreenable: false,
    maximizable: false,
    alwaysOnTop: true,       // 始终置顶
    skipTaskbar: true,       // 不显示在任务栏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // 更高层级置顶（能压过大部分普通窗口）
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // [临时诊断] 记录窗口关闭来源
  win.on('close', () => logExit('win close event'));

  // 关闭时记住位置
  win.on('close', () => {
    if (win) {
      const [x, y] = win.getPosition();
      cfg.pos = { x, y };
      saveConfig();
    }
  });
  win.on('closed', () => { win = null; });
}

// 打开设置窗口（单例）
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 500,
    height: 800,
    frame: false,           // 无边框，用自定义标题栏
    resizable: false,
    backgroundColor: '#f4f5f9',
    title: '小组件设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// 应用缩放（悬浮窗内容 + 窗口尺寸一起变）
function applyScale(scale) {
  cfg.scale = Math.min(2.5, Math.max(0.5, scale));
  const { w, h } = winSize(cfg.scale);
  if (win) win.setSize(w, h);
  saveConfig();
  broadcast();
}

// 鼠标穿透开关（forward 让鼠标事件仍转发给页面以便检测，这里整体穿透）
function setClickThrough(v) {
  cfg.clickThrough = v;
  if (win) win.setIgnoreMouseEvents(v, { forward: true });
  saveConfig();
  broadcast();
}

// 开机自启开关
function setAutoStart(v) {
  cfg.autoStart = v;
  app.setLoginItemSettings({ openAtLogin: v, path: process.execPath });
  saveConfig();
  broadcast();
}

// ===== 钉扎模式：'top' 置顶 / 'desktop' 嵌入桌面层（不遮挡其他窗口）=====
function applyPinMode(mode) {
  cfg.pinMode = mode === 'desktop' ? 'desktop' : 'top';
  saveConfig();
  if (!win) { broadcast(); return; }
  const wantEmbed = cfg.pinMode === 'desktop';
  if (wantEmbed && !embedded) embedWindow();
  else if (!wantEmbed && embedded) detachWindow();
  else broadcast();
}

// 读取窗口原生句柄（x64 下 8 字节指针）
function getHwnd() {
  try {
    return Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  } catch (e) {
    console.error('读取句柄失败:', e);
    return 0;
  }
}

// 嵌入桌面：把窗口 SetParent 到壁纸层的 WorkerW（Rainmeter 同款方案）
function embedWindow() {
  const hwnd = getHwnd();
  if (!hwnd) return;
  runEmbedScript('embed', hwnd, (ok) => {
    if (!win) return;
    if (!ok) { logExit('embed FAILED'); return; } // 嵌入失败保持置顶，不误标记
    embedded = true;
    win.setAlwaysOnTop(false); // 子窗口无置顶概念
    if (cfg.pos) win.setPosition(cfg.pos.x, cfg.pos.y);
    broadcast();
  });
}

// 从桌面层脱离，恢复置顶
function detachWindow() {
  const hwnd = getHwnd();
  if (!hwnd) { embedded = false; return; }
  runEmbedScript('detach', hwnd, () => {
    embedded = false;
    if (!win) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (cfg.pos) win.setPosition(cfg.pos.x, cfg.pos.y);
    broadcast();
  });
}

// 生成并执行嵌入/脱离的 PowerShell 脚本（-EncodedCommand 免引号转义）
function runEmbedScript(mode, hwnd, cb) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class EmbedWin {",
    "  public delegate bool EnumProc(IntPtr h, IntPtr l);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr FindWindow(string c, string t);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);",
    "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);",
    "  [DllImport(\"user32.dll\", SetLastError = true)] public static extern IntPtr SetParent(IntPtr c, IntPtr p);",
    "  public static IntPtr FindWorkerW() {",
    "    IntPtr workerW = IntPtr.Zero;",
    "    EnumWindows(delegate(IntPtr top, IntPtr l) {",
    "      if (FindWindowEx(top, IntPtr.Zero, \"SHELLDLL_DefView\", null) != IntPtr.Zero) {",
    "        workerW = FindWindowEx(IntPtr.Zero, top, \"WorkerW\", null);",
    "      }",
    "      return true;",
    "    }, IntPtr.Zero);",
    "    return workerW;",
    "  }",
    "}",
    "\"@",
    "$mode = '" + mode + "'",
    "$hwnd = [IntPtr]::new(" + hwnd + ")",
    "if ($mode -eq 'embed') {",
    "  $progman = [EmbedWin]::FindWindow('Progman', 'Program Manager')",
    "  $r = [IntPtr]::Zero",
    "  [EmbedWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$r) | Out-Null",
    "  Start-Sleep -Milliseconds 300",
    "  $worker = [EmbedWin]::FindWorkerW()",
    "  if ($worker -eq [IntPtr]::Zero) { Write-Output 'NO_WORKER' } else {",
    "    $null = [EmbedWin]::SetParent($hwnd, $worker)",
    "    $errCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "    if ($errCode -eq 0) { Write-Output 'EMBEDDED' } else { Write-Output ('SETPARENT_FAIL err=' + $errCode) }",
    "  }",
    "} else {",
    "  $null = [EmbedWin]::SetParent($hwnd, [IntPtr]::Zero)",
    "  $errCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "  if ($errCode -eq 0) { Write-Output 'DETACHED' } else { Write-Output ('SETPARENT_FAIL err=' + $errCode) }",
    "}"
  ].join('\n');
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
    { timeout: 10000 },
    (err, stdout) => {
      const out = String(stdout || '').trim();
      const ok = !err && out.includes('EMBEDDED');
      // [诊断] 记录嵌入脚本执行结果
      try {
        fs.appendFileSync(path.join(__dirname, '_embed_log.txt'),
          new Date().toISOString() + ` mode=${mode} hwnd=${hwnd} err=${err ? err.message : 'none'} out=${out}\n`);
      } catch { }
      if (cb) cb(ok);
    });
}

// 刷新托盘菜单（同步勾选状态）
function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// 构建托盘菜单
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示 / 隐藏小组件', click: () => { if (win) (win.isVisible() ? win.hide() : win.show()); } },
    {
      label: '鼠标穿透（锁定位置）', type: 'checkbox', checked: cfg.clickThrough,
      click: (item) => setClickThrough(item.checked)
    },
    {
      label: '嵌入桌面层（不遮挡其他窗口）', type: 'checkbox', checked: cfg.pinMode === 'desktop',
      click: (item) => applyPinMode(item.checked ? 'desktop' : 'top')
    },
    {
      label: '缩放',
      submenu: [75, 100, 125, 150, 200].map(z => ({
        label: z + '%', type: 'checkbox', checked: Math.round(cfg.scale * 100) === z,
        click: () => applyScale(z / 100)
      }))
    },
    { type: 'separator' },
    { label: '设置...', click: openSettings },
    {
      label: '开机自启', type: 'checkbox', checked: cfg.autoStart,
      click: (item) => setAutoStart(item.checked)
    },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } }
  ]);
}

// 创建托盘图标（复用内置宠物图）
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'pets', 'cat1.jpg');
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(cfg.widgetName || '桌面宠物小组件');
  tray.setContextMenu(buildTrayMenu());
}

// 注册所有 IPC 通道
function registerIpc() {
  // ---- 窗口拖动：渲染进程上报鼠标绝对坐标，主进程换算窗口位置 ----
  ipcMain.on('win-move-start', (e, x, y) => {
    if (!win) return;
    dragCtx = { mx: x, my: y, wx: win.getPosition() };
  });
  ipcMain.on('win-move', (e, x, y) => {
    if (!dragCtx || !win) return;
    win.setPosition(dragCtx.wx[0] + (x - dragCtx.mx), dragCtx.wx[1] + (y - dragCtx.my));
  });
  ipcMain.on('win-move-end', () => {
    dragCtx = null;
    if (win) {
      const [x, y] = win.getPosition();
      cfg.pos = { x, y };
      saveConfig();
    }
  });

  // ---- 缩放 ----
  ipcMain.on('win-resize', (e, scale) => applyScale(scale));

  // ---- 配置读写 ----
  ipcMain.handle('get-config', () => cfg);
  ipcMain.handle('save-config', (e, patch) => {
    Object.assign(cfg, patch);
    // 特殊配置项需要调用系统能力
    if ('autoStart' in patch) app.setLoginItemSettings({ openAtLogin: !!cfg.autoStart, path: process.execPath });
    if ('clickThrough' in patch && win) win.setIgnoreMouseEvents(!!cfg.clickThrough, { forward: true });
    if ('pinMode' in patch) applyPinMode(cfg.pinMode);
    if ('widgetName' in patch && tray) tray.setToolTip(cfg.widgetName || '桌面宠物小组件');
    saveConfig();
    broadcast();
    return cfg;
  });

  // ---- 选择宠物图片（支持 gif/png/jpg/webp/apng）----
  ipcMain.handle('choose-pet', async () => {
    const r = await dialog.showOpenDialog(settingsWin || win, {
      title: '选择宠物图片（支持 GIF 动图）',
      filters: [{ name: '图片', extensions: ['gif', 'png', 'jpg', 'jpeg', 'webp', 'apng'] }],
      properties: ['openFile']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---- 打开设置窗口 ----
  ipcMain.handle('open-settings', () => openSettings());
}

// 应用生命周期
const gotLock = app.requestSingleInstanceLock(); // 单实例：重复启动时聚焦已有窗口
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    cfg = loadConfig();
    // 如果配置里开了自启但系统没有注册（首次），同步一次
    app.setLoginItemSettings({ openAtLogin: !!cfg.autoStart, path: process.execPath });
    registerIpc();
    createWindow();
    createTray();
    // 启动时恢复钉扎模式（若配置为嵌入桌面）
    if (cfg.pinMode === 'desktop') applyPinMode('desktop');
  });

  app.on('window-all-closed', () => { logExit('window-all-closed'); app.quit(); });
  app.on('before-quit', () => logExit('before-quit'));
  app.on('render-process-gone', (e, w, d) => logExit('render-process-gone ' + JSON.stringify(d)));
  app.on('child-process-gone', (e, d) => logExit('child-process-gone ' + JSON.stringify(d)));
}
