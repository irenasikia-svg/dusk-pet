// 夕 · 毛玻璃气泡：显示内容后量出尺寸，交给主进程把窗口贴到她头顶
const api = window.duskPet;
const box = document.getElementById('box');
const text = document.getElementById('text');
const menu = document.getElementById('menu');

api.onBubble(({ text: t, menu: withMenu }) => {
  text.textContent = t;
  menu.hidden = !withMenu;
  box.classList.toggle('has-menu', !!withMenu);
  box.style.animation = 'none';
  void box.offsetWidth; // 重新播放出现动画
  box.style.animation = '';
  // 窗口隐藏时 requestAnimationFrame 不会触发，直接同步量尺寸
  const r = box.getBoundingClientRect();
  api.bubbleSize({ w: Math.ceil(r.width), h: Math.ceil(r.height) });
});

menu.addEventListener('click', (e) => {
  const how = e.target.dataset && e.target.dataset.how;
  if (how) api.bubbleChoose(how);
});
