// 从游戏数据抽取各角色的点击台词，生成 assets/voices.js（只在本地用，不进仓库）
// 数据：Kengxxiao/ArknightsGameData 的 zh_CN/gamedata/excel/charword_table.json，先下载到 ~/.cache/arknights-pet/
// 用法：node scripts/voices.js [charword_table.json 路径]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CHARACTERS } = require('../src/characters.js');

const src = process.argv[2] || path.join(os.homedir(), '.cache/arknights-pet/charword_table.json');
if (!fs.existsSync(src)) {
  console.error(`找不到 ${src}\n先下载：https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/charword_table.json`);
  process.exit(1);
}
const words = Object.values(JSON.parse(fs.readFileSync(src, 'utf8')).charWords);

// 单击＝主界面点干员时的「交谈」，连点＝「戳一下」「信赖触摸」
const GROUPS = {
  poke: /^(交谈|晋升后交谈|信赖提升后交谈)\d$/,
  combo: /^(戳一下|信赖触摸)$/,
};
const out = {};
for (const charId of new Set(CHARACTERS.map((c) => c.charId).filter(Boolean))) {
  const mine = words.filter((w) => w.wordKey === charId); // 只要默认语音，不要方言 / 异格语音
  const lines = {};
  for (const [g, re] of Object.entries(GROUPS)) {
    lines[g] = mine.filter((w) => re.test(w.voiceTitle)).map((w) => w.voiceText.replace(/\{@nickname\}/g, '博士').trim());
  }
  if (lines.poke.length || lines.combo.length) out[charId] = lines;
  console.log(charId, `交谈 ${lines.poke.length} 句，连点 ${lines.combo.length} 句`);
}
const file = path.join(__dirname, '../assets/voices.js');
fs.writeFileSync(file, `// 由 scripts/voices.js 生成，台词版权归鹰角，只在本地用\nwindow.VOICES = ${JSON.stringify(out, null, 1)};\n`);
console.log('写入', file);
