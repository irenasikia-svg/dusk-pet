// 换角色列表：滚轮滑动，点一下就换；↑↓ 选择、回车确认、Esc 关闭
const list = document.getElementById('list');
let items = [];
let hl = -1;

function highlight(i, scroll) {
  hl = Math.max(0, Math.min(items.length - 1, i));
  list.querySelectorAll('li').forEach((li, k) => li.classList.toggle('hl', k === hl));
  if (scroll) list.children[hl].scrollIntoView({ block: 'nearest' });
}

window.duskPet.onPicker((d) => {
  items = d.items;
  list.innerHTML = '';
  items.forEach((c, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(c.current));
    const check = document.createElement('span'); check.className = 'check'; check.textContent = c.current ? '✓' : '';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = c.name;
    const skin = document.createElement('span'); skin.className = 'skin'; skin.textContent = c.skin;
    li.append(check, name, skin);
    li.title = `${c.name} · ${c.skin}`;
    // 滚动后鼠标下面换了一行时也要跟着高亮（mouseover 在滚动时也会触发）
    for (const ev of ['mousemove', 'mouseover']) li.addEventListener(ev, () => { if (hl !== i) highlight(i); });
    li.addEventListener('click', () => window.duskPet.pickCharacter(c.key));
    list.appendChild(li);
  });
  hl = -1;
  // 打开时让当前角色停在列表中间附近
  const cur = items.findIndex((c) => c.current);
  if (cur >= 0) list.scrollTop = Math.max(0, list.children[cur].offsetTop - list.clientHeight / 2 + 12);
  list.focus();
});

list.addEventListener('mouseleave', () => { hl = -1; list.querySelectorAll('li.hl').forEach((li) => li.classList.remove('hl')); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.duskPet.closePicker();
  else if (e.key === 'ArrowDown') { e.preventDefault(); highlight(hl < 0 ? items.findIndex((c) => c.current) + 1 : hl + 1, true); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(hl < 0 ? items.findIndex((c) => c.current) - 1 : hl - 1, true); }
  else if (e.key === 'Enter' && hl >= 0) window.duskPet.pickCharacter(items[hl].key);
});
