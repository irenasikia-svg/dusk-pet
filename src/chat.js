// Claude 桌面版「对话」（Chat 标签页）正在回复的检测。
// 对话是 App 内的网页直接流式接收的，本机没有日志、主进程也不记录，所以从外部看行为：
//   - App 网络进程每秒收到的字节（nettop，不需要额外权限）：回复是持续好几秒的小流量下行
//   - 主窗口渲染进程的 CPU：在逐字渲染回复
// 两者同时持续一段时间，就认为对话正在回复。阈值根据实测标定（见 THRESHOLDS）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// 每次回复的起止时间记下来，给用量估算和 5 小时窗口推断用（对话没有本地日志）
const ACTIVITY_FILE = path.join(os.homedir(), '.claude', 'dusk-pet', 'chat-activity.json');
const KEEP_MS = 8 * 86400 * 1000;

function readFile() {
  try { return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')); } catch { return {}; }
}

function readActivity() {
  return readFile().replies || [];
}

// 从什么时候开始记录对话的；在这之前的官方读数里混着没记录的对话用量，不能拿来校准
function trackingSince() {
  return readFile().trackingSince || null;
}

function writeFile(data) {
  try {
    fs.mkdirSync(path.dirname(ACTIVITY_FILE), { recursive: true });
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(data));
  } catch { /* 写不了就算了，不影响检测 */ }
}

function appendActivity(reply) {
  const data = readFile();
  const cutoff = Date.now() - KEEP_MS;
  const replies = (data.replies || []).filter((r) => r.end >= cutoff);
  replies.push(reply);
  writeFile({ trackingSince: data.trackingSince || Date.now(), replies });
}

// 2026-10-15 实测：回复时每秒稳定收到 600–1000 字节、几乎不发送，渲染进程 CPU 3–5%；
// 平时后台只有每隔几秒一次的零星小包；切页面/打开设置是 10–300 KB 的突发并伴随大量上行。
const THRESHOLDS = {
  startIn: [400, 3000],   // 「像在流式回复」的一秒：收到的字节数范围
  startOutMax: 2000,      //   且几乎不往外发
  cpuMin: 2,              //   且渲染进程在忙（ps 的近期平均 CPU%）
  startSamples: 5,        // 最近 startWindow 秒里有这么多秒像回复，才开始算「正在回复」
  startWindow: 6,
  keepInMin: 300,         // 已经在回复时，只要还有下行就继续（回复中偶尔夹着上传）
  endQuiet: 4,            // 连续这么多秒几乎没下行，就算答完了
  minReplyMs: 5000,       // 回复持续这么久以上，结束时才「完成」开心一下
};

class ChatWatcher {
  constructor() {
    this.netPid = null;
    this.proc = null;
    this.samples = []; // { t, bytesIn, cpu }
    this.rendererCpu = 0;
    this.active = false;
    this.activeSince = 0;
    this.lastStream = 0;
    this.lastEnded = 0;
    this.lastDuration = 0;
  }

  // 由 Monitor 每次刷新进程列表时调用
  update({ netPid, rendererCpu }) {
    this.rendererCpu = rendererCpu || 0;
    if (netPid !== this.netPid) this.restart(netPid);
  }

  restart(netPid) {
    this.stop();
    this.netPid = netPid;
    if (!netPid) return;
    if (!trackingSince()) writeFile({ trackingSince: Date.now(), replies: readActivity() });
    // nettop 写管道时会整块缓冲，用 script 给它一个伪终端，样本才能逐秒到达
    this.proc = spawn('/usr/bin/script', ['-q', '/dev/null', '/usr/bin/nettop', '-P', '-d', '-L', '0', '-s', '1', '-x',
      '-J', 'bytes_in,bytes_out', '-p', String(netPid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    this.proc.stdout.on('data', (chunk) => {
      buf += chunk.toString().replace(/\r/g, '');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) this.onLine(line);
    });
    this.proc.on('exit', () => { if (this.proc && this.proc.exitCode !== null) this.proc = null; });
  }

  stop() {
    if (this.proc) {
      try { this.proc.kill(); } catch { /* 已经退出 */ }
      this.proc = null;
    }
  }

  onLine(line) {
    if (!line.startsWith('Claude Helper')) return;
    const parts = line.split(',');
    this.push({ t: Date.now(), bytesIn: +parts[1] || 0, bytesOut: +parts[2] || 0, cpu: this.rendererCpu });
  }

  push(sample) {
    this.samples.push(sample);
    if (this.samples.length > 30) this.samples.shift();
    this.evaluate(sample.t);
  }

  looksLikeStream(s) {
    const [lo, hi] = THRESHOLDS.startIn;
    return s.bytesIn >= lo && s.bytesIn <= hi && s.bytesOut <= THRESHOLDS.startOutMax && s.cpu >= THRESHOLDS.cpuMin;
  }

  evaluate(now) {
    const last = this.samples[this.samples.length - 1];
    if (!this.active) {
      const recent = this.samples.slice(-THRESHOLDS.startWindow);
      if (recent.filter((s) => this.looksLikeStream(s)).length >= THRESHOLDS.startSamples) {
        this.active = true;
        this.activeSince = recent[0].t;
        this.lastStream = now;
      }
      return;
    }
    if (last.bytesIn >= THRESHOLDS.keepInMin) this.lastStream = now;
    else if (now - this.lastStream >= THRESHOLDS.endQuiet * 1000) {
      this.active = false;
      this.lastEnded = this.lastStream;
      this.lastDuration = this.lastStream - this.activeSince;
      if (this.samples.length && !this.replay) appendActivity({ start: this.activeSince, end: this.lastStream });
    }
  }

  // 所有已知的回复时段（含正在进行的），给用量估算用
  replies(now = Date.now()) {
    const list = readActivity();
    if (this.active) list.push({ start: this.activeSince, end: now });
    return list;
  }

  // 给 Monitor 的状态：working / done / idle
  status(now = Date.now()) {
    if (this.active) return { status: 'working', since: this.activeSince, mtime: now };
    if (this.lastEnded && this.lastDuration >= THRESHOLDS.minReplyMs) {
      return { status: 'done', since: this.lastEnded, mtime: this.lastEnded };
    }
    return { status: 'idle', since: this.lastEnded, mtime: this.lastEnded };
  }
}

module.exports = { ChatWatcher, THRESHOLDS, readActivity, trackingSince };
