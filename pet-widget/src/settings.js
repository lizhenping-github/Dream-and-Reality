/**
 * 设置窗口渲染进程：表单初始化、宠物图片选择、保存配置
 */
const $ = (s) => document.querySelector(s);

// 内置宠物形象
const PRESET_PETS = [
  { id: 'cat1', name: '橘猫' },
  { id: 'cat2', name: '灰猫' },
  { id: 'panda', name: '熊猫' }
];
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 字体颜色预设（与截图色板一致）
const FC_PRESETS = ['#111111', '#ffffff', '#e5484d', '#f76b15', '#ffb224', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#79583d', '#e93d82'];
// 背景颜色预设
const BG_PRESETS = ['#ffffff', '#111111', '#fdf6ec', '#fdecef', '#fff3e0', '#e8f5e9', '#e3f2fd', '#f3e5f5', '#fffde7', '#e0f2f1', '#fbe9e7'];

let cfg = null; // 当前配置快照
const tmp = { petPreset: '', petPath: '' }; // 宠物选择临时状态

// ===== 初始化 =====
(async function init() {
  cfg = await api.getConfig();
  tmp.petPreset = cfg.petPreset || 'cat1';
  tmp.petPath = cfg.petPath || '';

  $('#widgetName').value = cfg.widgetName || '';
  $('#workStart').value = cfg.workStart || '09:00';
  $('#workEnd').value = cfg.workEnd || '18:00';
  $('#petName').value = cfg.petName || '';
  $('#dailyIncome').value = cfg.dailyIncome ?? 500;
  $('#bubbleEnabled').checked = cfg.bubbleEnabled !== false;
  $('#pinDesktop').checked = cfg.pinMode === 'desktop';
  $('#autoStart').checked = !!cfg.autoStart;
  $('#clickThrough').checked = !!cfg.clickThrough;

  buildWorkdays();
  buildPayday();
  buildSwatches('#fontColors', FC_PRESETS, () => cfg.fontColor, (c) => { cfg.fontColor = c; });
  buildSwatches('#bgColors', BG_PRESETS, () => cfg.bgColor, (c) => { cfg.bgColor = c; });
  buildPets();
  bindMisc();
})();

// 工作日多选胶囊
function buildWorkdays() {
  const box = $('#workdays');
  const sel = new Set(cfg.workdays || []);
  DAY_NAMES.forEach((name, i) => {
    const d = i + 1;
    const b = document.createElement('div');
    b.className = 'chip' + (sel.has(d) ? ' on' : '');
    b.textContent = name;
    b.onclick = () => { sel.has(d) ? sel.delete(d) : sel.add(d); b.classList.toggle('on'); };
    box.appendChild(b);
  });
  box._get = () => [...sel].sort((a, b) => a - b);
}

// 发薪日下拉（1~31 日）
function buildPayday() {
  const s = $('#payday');
  for (let i = 1; i <= 31; i++) {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `每月 ${i} 日`;
    s.appendChild(o);
  }
  s.value = cfg.payday || 10;
}

// 颜色色板：预设圆点 + 自定义拾色器
function buildSwatches(sel, presets, getCur, setCur) {
  const box = $(sel);

  function render() {
    box.innerHTML = '';
    const cur = (getCur() || '').toLowerCase();
    presets.forEach((c) => {
      const d = document.createElement('div');
      d.className = 'sw' + (c.toLowerCase() === cur ? ' on' : '');
      d.style.background = c;
      d.title = c;
      d.onclick = () => { setCur(c); render(); };
      box.appendChild(d);
    });
    // 自定义颜色输入
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'colorInput';
    inp.title = '自定义颜色';
    inp.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff';
    inp.oninput = () => setCur(inp.value);
    inp.onchange = () => render();
    box.appendChild(inp);
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '自定义';
    box.appendChild(hint);
  }
  render();
}

// 宠物形象：内置三个 + 自定义上传
function buildPets() {
  const box = $('#petList');
  box.innerHTML = '';

  function mark() {
    [...box.children].forEach((el, i) => {
      if (i < PRESET_PETS.length) {
        el.classList.toggle('on', !tmp.petPath && tmp.petPreset === PRESET_PETS[i].id);
      } else {
        // 自定义项：有自定义图片时选中
        el.classList.toggle('on', !!tmp.petPath);
      }
    });
  }

  // 内置形象
  PRESET_PETS.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'pet-item';
    d.title = p.name;
    const img = document.createElement('img');
    img.src = '../assets/pets/' + p.id + '.jpg';
    d.appendChild(img);
    d.onclick = () => { tmp.petPreset = p.id; tmp.petPath = ''; mark(); };
    box.appendChild(d);
  });

  // 自定义项（显示当前自定义图或加号）
  const cus = document.createElement('div');
  cus.className = 'pet-item custom';
  renderCustom(cus);
  cus.onclick = async () => {
    const p = await api.choosePet();
    if (!p) return;
    tmp.petPath = p; // 记录自定义路径
    tmp.petPreset = '';
    renderCustom(cus);
    mark();
  };
  box.appendChild(cus);
  mark();

  function renderCustom(el) {
    el.innerHTML = '';
    if (tmp.petPath) {
      const img = document.createElement('img');
      img.src = 'file:///' + tmp.petPath.replace(/\\/g, '/');
      img.title = tmp.petPath;
      el.appendChild(img);
    } else {
      el.innerHTML = '<div class="plus">＋</div><div class="txt">自定义<br>GIF/图片</div>';
    }
  }
}

// 其余控件与保存/关闭
function bindMisc() {
  $('#closeBtn').onclick = () => window.close();

  $('#saveBtn').onclick = async () => {
    await api.saveConfig({
      widgetName: $('#widgetName').value.trim() || '下班倒计时',
      workdays: $('#workdays')._get(),
      workStart: $('#workStart').value || '09:00',
      workEnd: $('#workEnd').value || '18:00',
      fontColor: cfg.fontColor,
      bgColor: cfg.bgColor,
      payday: Number($('#payday').value),
      dailyIncome: Math.max(0, Number($('#dailyIncome').value) || 0),
      petPreset: tmp.petPreset,
      petPath: tmp.petPath,
      petName: $('#petName').value.trim() || '宠物',
      bubbleEnabled: $('#bubbleEnabled').checked,
      pinMode: $('#pinDesktop').checked ? 'desktop' : 'top',
      autoStart: $('#autoStart').checked,
      clickThrough: $('#clickThrough').checked
    });
    window.close(); // 保存后关闭设置窗口
  };
}
