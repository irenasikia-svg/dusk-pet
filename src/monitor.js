// 汇总三路信号：钩子事件、会话日志、系统进程 → 夕的状态 + 面板数据
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { UsageTracker } = require('./usage');
const { PlanUsage } = require('./plan');
const { ChatWatcher } = require('./chat');

const EVENTS_DIR = path.join(os.homedir(), '.claude', 'dusk-pet', 'events');
const ACTIVE_WRITE_MS = 8000;          // 日志 8 秒内有写入 → 正在处理
const STALE_WORKING_MS = 10 * 60 * 1000; // 钩子说在忙但 10 分钟没动静 → 视为中断
const DONE_FLASH_MS = 8000;            // 完成后开心 8 秒
const WAITING_DECAY_MS = 60 * 1000;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: 4000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

function parseEtime(s) {
  // [[dd-]hh:]mm:ss
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return 0;
  return ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + +m[3] * 60 + +m[4]) * 1000;
}

class Monitor {
  constructor() {
    this.usage = new UsageTracker();
    this.plan = new PlanUsage(this.usage);
    this.chat = new ChatWatcher();
    this.procs = [];
    this.app = null;
    this.lastUsageRefresh = 0;
  }

  readHookEvents() {
    const out = new Map();
    let names = [];
    try { names = fs.readdirSync(EVENTS_DIR); } catch { return out; }
    const now = Date.now();
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const p = path.join(EVENTS_DIR, n);
      try {
        const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (now - rec.ts > 2 * 86400 * 1000) { fs.rmSync(p, { force: true }); continue; }
        out.set(rec.session_id, rec);
      } catch { /* 写到一半，下次再读 */ }
    }
    return out;
  }

  async refreshProcesses() {
    const ps = await run('/bin/ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,etime=,args=']);
    const rows = [];
    for (const line of ps.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      rows.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], mem: +m[4] * 1024, uptime: parseEtime(m[5]), args: m[6] });
    }

    const appMain = rows.find((r) => /\/Claude\.app\/Contents\/MacOS\/Claude(\s|$)/.test(r.args));
    const appPids = new Set();
    if (appMain) {
      appPids.add(appMain.pid);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of rows) if (!appPids.has(r.pid) && appPids.has(r.ppid)) { appPids.add(r.pid); grew = true; }
      }
    }

    const sessions = rows.filter((r) => {
      const head = r.args.split(' -')[0];
      return /(^|\/)claude(\s|$)/.test(head) || /@anthropic-ai\/claude-code\/cli\.js/.test(r.args);
    });

    const cwdOut = sessions.length
      ? await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', sessions.map((s) => s.pid).join(',')])
      : '';
    const cwds = {};
    let cur = 0;
    for (const l of cwdOut.split('\n')) {
      if (l[0] === 'p') cur = +l.slice(1);
      else if (l[0] === 'n') cwds[cur] = l.slice(1);
    }

    this.procs = sessions.map((s) => {
      const model = /--model[= ](\S+)/.exec(s.args);
      const mode = /--permission-mode[= ](\S+)/.exec(s.args);
      return {
        pid: s.pid,
        kind: appPids.has(s.pid) ? 'desktop' : 'cli',
        cpu: s.cpu,
        mem: s.mem,
        uptime: s.uptime,
        cwd: cwds[s.pid] || '',
        model: model ? model[1] : '',
        mode: mode ? mode[1] : '',
      };
    }).sort((a, b) => a.uptime - b.uptime);

    // 「对话」标签页的检测：App 的网络进程 + 主窗口渲染进程（内存最大的那个）
    const appRows = rows.filter((r) => appPids.has(r.pid));
    const net = appRows.find((r) => /network\.mojom\.NetworkService/.test(r.args));
    const renderer = appRows.filter((r) => /--type=renderer/.test(r.args)).sort((a, b) => b.mem - a.mem)[0];
    this.chat.update({ netPid: net ? net.pid : null, rendererCpu: renderer ? renderer.cpu : 0 });

    if (appMain) {
      const all = rows.filter((r) => appPids.has(r.pid) && !sessions.some((s) => s.pid === r.pid));
      this.app = {
        pid: appMain.pid,
        cpu: all.reduce((a, r) => a + r.cpu, 0),
        mem: all.reduce((a, r) => a + r.mem, 0),
        uptime: appMain.uptime,
        helpers: all.length - 1,
      };
    } else {
      this.app = null;
    }
  }

  async tick(systemIdleSec = 0, cfg = {}) {
    const now = Date.now();
    if (now - this.lastUsageRefresh > 2500) {
      try { this.usage.refresh(); } catch (e) { console.error('usage refresh', e); }
      this.lastUsageRefresh = now;
    }
    await this.refreshProcesses();

    const hooks = this.readHookEvents();
    const logSessions = this.usage.sessions();
    const byId = new Map(logSessions.map((s) => [s.id, s]));
    for (const [id, h] of hooks) {
      if (!byId.has(id) && now - h.ts < 12 * 3600 * 1000) {
        byId.set(id, { id, mtime: h.ts, title: '（新会话）', cwd: h.cwd, model: '', lastType: '', lastStop: '' });
      }
    }

    const sessions = [];
    for (const s of byId.values()) {
      const h = hooks.get(s.id);
      const writing = now - s.mtime < ACTIVE_WRITE_MS;
      let status = 'idle';
      let since = s.mtime;
      if (h) {
        status = h.status;
        since = h.ts;
        if (status === 'working' && now - Math.max(h.ts, s.mtime) > STALE_WORKING_MS) status = 'idle';
        // 批准权限后要等工具跑完才有下一个事件：超过 1 分钟且你之后动过键鼠，就当已批准、在跑
        if (status === 'waiting' && now - h.ts > WAITING_DECAY_MS && systemIdleSec * 1000 < now - h.ts - 5000) status = 'working';
        if (status === 'done' && writing && s.mtime > h.ts + 1500) status = 'working';
      } else if (writing) {
        status = s.lastType === 'assistant' && s.lastStop === 'end_turn' ? 'done' : 'working';
      } else if (s.lastType === 'assistant' && s.lastStop === 'end_turn') {
        status = 'done';
      }
      if (status === 'done' && now - Math.max(since, s.mtime) > DONE_FLASH_MS) status = 'idle';
      sessions.push({ ...s, status, since, tool: h ? h.tool : '', hookMsg: h ? h.message : '' });
    }
    // Claude 桌面版的「对话」（Chat 标签页）：没有本地日志，靠 ChatWatcher 推断
    const chat = this.chat.status(now);
    if (chat.mtime && now - chat.mtime < 12 * 3600 * 1000) {
      let status = chat.status;
      if (status === 'done' && now - chat.since > DONE_FLASH_MS) status = 'idle';
      sessions.push({ id: 'claude-chat', source: 'chat', title: 'Claude 对话', cwd: '', model: '', mtime: chat.mtime, since: chat.since, status, tool: '', hookMsg: '' });
    }
    sessions.sort((a, b) => rank(a.status) - rank(b.status) || b.mtime - a.mtime);

    const usage = this.usage.summary();
    const lastClaudeActivity = Math.max(usage.lastActivity, ...sessions.map((s) => s.mtime), 0);
    let overall = 'idle';
    if (sessions.some((s) => s.status === 'waiting')) overall = 'waiting';
    else if (sessions.some((s) => s.status === 'working')) overall = 'working';
    else if (sessions.some((s) => s.status === 'done')) overall = 'done';

    return {
      overall,
      lastClaudeActivity,
      sessions: sessions.slice(0, 12),
      procs: this.procs,
      app: this.app,
      usage,
      plan: this.plan.summary(cfg, this.chat.replies(now)),
      hooksSeen: hooks.size > 0,
      chatActive: chat.status === 'working',
      at: now,
    };
  }
}

Monitor.prototype.stop = function stop() {
  this.chat.stop();
};

function rank(status) {
  return { waiting: 0, working: 1, done: 2, idle: 3 }[status] ?? 4;
}

module.exports = { Monitor };
