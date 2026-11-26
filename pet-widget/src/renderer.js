/**
 * 悬浮窗渲染进程：倒计时计算、拖动/缩放、宠物点击互动、气泡语录
 */
const $ = (s) => document.querySelector(s);

let cfg = null;                 // 当前配置
let rafMove = null;             // 拖动节流
let pendingMove = null;
let rafResize = null;           // 缩放节流
let pendingResize = null;
let bubbleTimer = null;         // 气泡隐藏定时器
let lastMoneyText = '';         // 上次金额文本（变化时才重新自适应字号）

// 设计基准尺寸（与主进程 BASE_W/BASE_H 保持一致）
const BASE_W = 432;
const BASE_H = 252;

// 宠物随机语录
const QUOTES = [
  '再摸一条鱼就下班啦～',
  '记得多喝口水哦',
  '起来伸个懒腰吧～',
  '有心事找我跟哦',
  '今天也要元气满满！',
  '代码可以不写，饭一定要吃',
  '距离搞钱又近了一步',
  '老板来了？我什么都没说',
  '摸摸我，好运加倍',
  '别卷了，卷不动了～',
  '晚上吃点什么好呢',
  '离下班又近了一秒',
  '工资在路上了，别催',
  '久坐伤腰，起来走走'
];

// ===== 工具函数 =====
const p2 = (n) => String(n).padStart(2, '0');
const clampScale = (s) => Math.min(2.5, Math.max(0.5, s));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 秒数 → "HH : MM : SS"
function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${p2(Math.floor(sec / 3600))} : ${p2(Math.floor((sec % 3600) / 60))} : ${p2(sec % 60)}`;
}

// "09:30" → 秒数
function parseHM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
}

// ===== 宠物图片地址 =====
function petSrc() {
  if (cfg.petPath) {
    // 本地自定义图片（支持 gif）
    return 'file:///' + cfg.petPath.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  return '../assets/pets/' + (cfg.petPreset || 'cat1') + '.jpg';
}

// ===== 应用配置到界面 =====
function applyCfg() {
  const root = document.documentElement;
  root.style.setProperty('--fc', cfg.fontColor);
  root.style.setProperty('--bg', cfg.bgColor);
  document.body.style.zoom = cfg.scale; // 整体缩放
  $('#petImg').src = petSrc();
  $('#petArea').classList.toggle('custom-pet', !!cfg.petPath);
  $('#petName').textContent = cfg.petName || '宠物';
  autoFitMoney(); // 配置变化（缩放等）后重新校准金额字号
}

// ===== 每秒刷新倒计时与统计 =====
function tick() {
  const now = new Date();
  const dayIdx = now.getDay() === 0 ? 7 : now.getDay(); // 1=周一 ... 7=周日
  const isWorkday = (cfg.workdays || []).includes(dayIdx);
  const secs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const start = parseHM(cfg.workStart);
  const end = parseHM(cfg.workEnd);

  const labelEl = $('#label');
  const timeEl = $('#time');

  // 倒计时状态
  if (!isWorkday) {
    labelEl.textContent = '今天不上班';
    timeEl.textContent = '🎉 周末愉快';
  } else if (secs < start) {
    labelEl.textContent = '距离上班还有';
    timeEl.textContent = fmtDur(start - secs);
  } else if (secs < end) {
    labelEl.textContent = '距离下班还有';
    timeEl.textContent = fmtDur(end - secs);
  } else {
    labelEl.textContent = '已经下班啦';
    timeEl.textContent = '🎉 冲！';
  }

  // 今日收入：按工作时间线性累计
  let earned = 0;
  if (isWorkday && end > start) {
    if (secs >= start && secs <= end) earned = cfg.dailyIncome * (secs - start) / (end - start);
    else if (secs > end) earned = cfg.dailyIncome;
  }
  const moneyText = earned.toFixed(2);
  if (moneyText !== lastMoneyText) {
    $('#statMoney').textContent = moneyText;
    lastMoneyText = moneyText;
    autoFitMoney();
  }

  // 距离周五（周末）
  const dFri = (5 - dayIdx + 7) % 7;
  $('#statWeek').innerHTML = (dFri === 0 ? '今天' : dFri) + '<i>天</i>';

  // 距离发薪日（每月 payday 日）
  const today = now.getDate();
  let dPay;
  if (cfg.payday >= today) {
    dPay = cfg.payday - today;
  } else {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    dPay = daysInMonth - today + cfg.payday;
  }
  $('#statPay').innerHTML = dPay + '<i>天</i>';
}

// ===== 金额字号自适应 =====
// 内容超宽时逐步缩小字体，保证至少展示 7 位以上（含小数），最低 10px
function autoFitMoney() {
  const v = document.querySelector('.stat.money .v');
  if (!v) return;
  v.style.fontSize = ''; // 先恢复默认字号，保证测量基准一致
  let size = parseFloat(getComputedStyle(v).fontSize);
  let guard = 0;
  // scrollWidth > clientWidth 说明内容被截断（.v 设有 overflow:hidden）
  while (v.scrollWidth > v.clientWidth && size > 10 && guard < 25) {
    size -= 0.5;
    v.style.fontSize = size + 'px';
    guard++;
  }
}

// ===== 气泡语录 =====
function say(text) {
  if (cfg && cfg.bubbleEnabled === false) return;
  const b = $('#bubble');
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => b.classList.remove('show'), 2600);
}

// 随机气泡：间隔 45~75 秒
function scheduleBubble() {
  setTimeout(() => {
    say(rand(QUOTES));
    playAnim();
    scheduleBubble();
  }, 45000 + Math.random() * 30000);
}

// ===== 宠物点击互动 =====
const ANIMS = ['play-wiggle', 'play-jump', 'play-shake', 'play-spin'];

function playAnim() {
  const area = $('#petArea');
  const cls = rand(ANIMS);
  area.classList.remove(...ANIMS);
  void area.offsetWidth; // 强制重绘以重启动画
  area.classList.add(cls);
}

$('#petArea').addEventListener('animationend', () => {
  $('#petArea').classList.remove(...ANIMS);
});

// 单击：随机动画 + 语录
$('#petArea').addEventListener('click', () => {
  playAnim();
  say(rand(QUOTES));
});

// 双击：摸头彩蛋，爱心爆发
$('#petArea').addEventListener('dblclick', () => {
  hearts();
  say('摸头杀～好运爆棚！');
});

// 爱心特效
function hearts() {
  const fx = $('#fx');
  const icons = ['❤', '💖', '✨', '🎉'];
  for (let i = 0; i < 7; i++) {
    const s = document.createElement('span');
    s.className = 'heart';
    s.textContent = icons[i % icons.length];
    s.style.left = (8 + Math.random() * 80) + '%';
    s.style.animationDelay = (Math.random() * 0.25) + 's';
    fx.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }
}

// ===== 整体拖动（手动实现，保证点击与拖动共存）=====
let press = null;
let moved = false;

$('#stage').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.no-drag')) return; // 宠物与手柄不触发拖动
  press = { sx: e.screenX, sy: e.screenY, t: Date.now() };
  moved = false;
  api.moveStart(e.screenX, e.screenY);
});

window.addEventListener('mousemove', (e) => {
  // 拖动窗口
  if (press) {
    if (Math.abs(e.screenX - press.sx) + Math.abs(e.screenY - press.sy) > 4) moved = true;
    if (moved) {
      // 用 rAF 节流 IPC 频率
      pendingMove = { x: e.screenX, y: e.screenY };
      if (!rafMove) {
        rafMove = requestAnimationFrame(() => {
          api.move(pendingMove.x, pendingMove.y);
          rafMove = null;
        });
      }
    }
    return;
  }
  // 拖动缩放手柄
  if (resizing) {
    const dx = e.screenX - resizing.sx;
    const dy = e.screenY - resizing.sy;
    const ns = clampScale(resizing.s0 + (dx / BASE_W + dy / BASE_H) / 2);
    pendingResize = ns;
    if (!rafResize) {
      rafResize = requestAnimationFrame(() => {
        api.resize(pendingResize);
        rafResize = null;
      });
    }
  }
});

window.addEventListener('mouseup', () => {
  if (press) {
    api.moveEnd();
    press = null;
  }
  if (resizing) {
    api.resize(pendingResize); // 结束时确认最终值
    resizing = null;
  }
});

// ===== 缩放 =====
let resizing = null;

$('#grip').addEventListener('mousedown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  resizing = { sx: e.screenX, sy: e.screenY, s0: cfg.scale };
});

// Ctrl + 滚轮 缩放
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    api.resize(clampScale(cfg.scale + (e.deltaY < 0 ? 0.05 : -0.05)));
  }
}, { passive: false });

// ===== 右键卡片打开设置 =====
window.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.no-drag')) return;
  e.preventDefault();
  api.openSettings();
});

// ===== 初始化 =====
(async function init() {
  cfg = await api.getConfig();
  applyCfg();
  tick();
  setInterval(tick, 250);
  scheduleBubble();
  // 配置变更（设置窗口保存 / 托盘操作）时实时应用
  api.onConfigUpdated((c) => { cfg = c; applyCfg(); });
})();
