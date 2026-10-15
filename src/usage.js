// 增量解析 ~/.claude/projects/**/*.jsonl（与 ccusage 同口径：按 message.id + requestId 去重）
// 同时从每个会话日志的尾部推断会话标题与状态。
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const KEEP_DAYS = 35;
const BLOCK_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

class UsageTracker {
  constructor() {
    this.files = new Map(); // file -> { offset, rest, mtime, meta }
    this.seen = new Set();
    this.records = []; // { t, model, input, output, cacheW, cacheR, session, project }
  }

  listJsonl(dir, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) this.listJsonl(p, out);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
    return out;
  }

  refresh() {
    const cutoff = Date.now() - KEEP_DAYS * DAY_MS;
    for (const file of this.listJsonl(PROJECTS)) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      let info = this.files.get(file);
      if (!info) {
        info = { offset: 0, rest: '', mtime: 0, meta: { title: '', cwd: '', model: '', lastType: '', lastStop: '', lastTs: 0 } };
        this.files.set(file, info);
      }
      info.mtime = st.mtimeMs;
      if (st.size < info.offset) { info.offset = 0; info.rest = ''; }
      if (st.size === info.offset) continue;
      this.readChunk(file, info, st.size);
    }
    const keepFrom = Date.now() - KEEP_DAYS * DAY_MS;
    if (this.records.length && this.records[0].t < keepFrom) {
      this.records = this.records.filter((r) => r.t >= keepFrom);
    }
  }

  readChunk(file, info, size) {
    const fd = fs.openSync(file, 'r');
    try {
      const len = size - info.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, info.offset);
      info.offset = size;
      const text = info.rest + buf.toString('utf8');
      const lines = text.split('\n');
      info.rest = lines.pop();
      const isSub = file.includes(`${path.sep}subagents${path.sep}`);
      const session = isSub ? path.basename(path.dirname(path.dirname(file))) : path.basename(file, '.jsonl');
      const project = path.basename(path.dirname(isSub ? path.dirname(path.dirname(file)) : file));
      for (const line of lines) {
        if (!line) continue;
        let d;
        try { d = JSON.parse(line); } catch { continue; }
        this.ingest(d, info.meta, session, project, isSub);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  ingest(d, meta, session, project, isSub) {
    const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
    if (!isSub) {
      if (d.type === 'custom-title' && d.customTitle) meta.title = d.customTitle;
      if (d.type === 'summary' && d.summary && !meta.title) meta.title = d.summary;
      if (d.cwd) meta.cwd = d.cwd;
      if (d.type === 'user' && !meta.firstPrompt) {
        const c = d.message && d.message.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text') || {}).text : '';
        if (text && !text.startsWith('<')) meta.firstPrompt = text.slice(0, 60);
      }
      if (d.type === 'user' || d.type === 'assistant') {
        meta.lastType = d.type;
        meta.lastStop = d.type === 'assistant' ? (d.message && d.message.stop_reason) || '' : '';
        if (ts) meta.lastTs = ts;
      }
      if (d.type === 'assistant' && d.message && d.message.model && d.message.model !== '<synthetic>') meta.model = d.message.model;
    }

    if (d.type !== 'assistant' || !d.message || !d.message.usage) return;
    const m = d.message;
    if (m.model === '<synthetic>') return;
    const key = `${m.id || ''}:${d.requestId || ''}`;
    if (key !== ':' && this.seen.has(key)) return;
    this.seen.add(key);
    const u = m.usage;
    this.records.push({
      t: ts || Date.now(),
      model: m.model || 'unknown',
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheW: u.cache_creation_input_tokens || 0,
      cacheR: u.cache_read_input_tokens || 0,
      session,
      project,
    });
  }

  // —— 汇总 ——
  summary() {
    const now = Date.now();
    const recs = this.records.slice().sort((a, b) => a.t - b.t);
    const sum = (list) => list.reduce((acc, r) => {
      acc.input += r.input; acc.output += r.output; acc.cacheW += r.cacheW; acc.cacheR += r.cacheR;
      acc.total += r.input + r.output + r.cacheW + r.cacheR; acc.calls += 1;
      return acc;
    }, { input: 0, output: 0, cacheW: 0, cacheR: 0, total: 0, calls: 0 });

    // ccusage 式 5 小时窗口：首条消息所在整点起算，满 5h 或空档 ≥5h 开新窗口
    let block = null;
    for (const r of recs) {
      if (!block || r.t >= block.end || r.t - block.last >= BLOCK_MS) {
        const start = new Date(r.t); start.setMinutes(0, 0, 0);
        block = { start: start.getTime(), end: start.getTime() + BLOCK_MS, last: r.t, items: [] };
      }
      block.last = r.t;
      block.items.push(r);
    }
    const active = block && now < block.end ? block : null;

    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const todayRecs = recs.filter((r) => r.t >= today0.getTime());
    const weekRecs = recs.filter((r) => r.t >= now - 7 * DAY_MS);

    const byModel = {};
    for (const r of weekRecs) {
      const k = prettyModel(r.model);
      byModel[k] = (byModel[k] || 0) + r.input + r.output + r.cacheW + r.cacheR;
    }

    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d0 = today0.getTime() - i * DAY_MS;
      const items = recs.filter((r) => r.t >= d0 && r.t < d0 + DAY_MS);
      days.push({ date: d0, total: sum(items).total, output: sum(items).output });
    }

    // 输出速率（最近 10 分钟）
    const recent = recs.filter((r) => r.t >= now - 10 * 60 * 1000);
    const burn = Math.round(sum(recent).output / 10);

    return {
      block: active ? { ...sum(active.items), start: active.start, end: active.end } : null,
      today: sum(todayRecs),
      week: sum(weekRecs),
      byModel: Object.entries(byModel).sort((a, b) => b[1] - a[1]),
      days,
      burnPerMin: burn,
      lastActivity: recs.length ? recs[recs.length - 1].t : 0,
    };
  }

  // 最近一次 Claude 调用的时间（不用排序整份记录，便宜）
  lastActivity() {
    let t = 0;
    for (const r of this.records) if (r.t > t) t = r.t;
    return t;
  }

  // 最近活跃的会话（主日志，不含子代理）
  sessions(withinMs = 12 * 3600 * 1000) {
    const now = Date.now();
    const out = [];
    for (const [file, info] of this.files) {
      if (file.includes(`${path.sep}subagents${path.sep}`)) continue;
      if (now - info.mtime > withinMs) continue;
      const m = info.meta;
      out.push({
        id: path.basename(file, '.jsonl'),
        file,
        mtime: info.mtime,
        title: m.title || m.firstPrompt || '（未命名会话）',
        cwd: m.cwd,
        model: prettyModel(m.model),
        lastType: m.lastType,
        lastStop: m.lastStop,
      });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
}

function prettyModel(id) {
  if (!id) return '';
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] && m[3].length <= 2 ? '.' + m[3] : ''}`;
  return id.replace(/^claude-/, '');
}

module.exports = { UsageTracker, prettyModel };
