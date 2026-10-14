// 套餐额度：5 小时 / 每周的百分比用量与剩余量
// 官方数据来自 Claude 桌面版自己记录的 plan-usage-history.json（fh = 5 小时 %，sd = 每周 %）。
// 桌面版只在菜单栏图标最近被打开过时才在后台刷新，所以数据可能过时；
// 过时的部分用本机 Claude 日志里的输出 token 按历史比例外推，界面上标「≈」。
const fs = require('fs');
const path = require('path');
const os = require('os');

const HISTORY = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'plan-usage-history.json');
// 额外的官方读数（例如在 Claude 会话里查到的用量），格式 {samples:[{t, fh, sd}]}，和桌面版的记录合并使用
const EXTRA = path.join(os.homedir(), '.claude', 'dusk-pet', 'plan-samples.json');
const H5 = 5 * 3600 * 1000;
const WEEK = 7 * 86400 * 1000;
const FRESH_MS = 5 * 60 * 1000;
// 没有足够历史做校准时的兜底比例（来自 2026-10 的实测：Pro 套餐）
const FALLBACK_KW = 8e-5;      // 每个输出 token 占每周额度的百分比
const FALLBACK_RATIO = 5;      // 5 小时 % 的增速 ≈ 每周 % 的 5 倍

// 取下中位数：样本少时偏保守，宁可少估也不吓人
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) / 2)];
};
const ceilMinute = (t) => Math.ceil(t / 60000) * 60000;

class PlanUsage {
  constructor(tracker) {
    this.tracker = tracker;
    this.mtime = 0;
    this.samples = [];
  }

  load() {
    const stamp = [HISTORY, EXTRA].map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join(':');
    if (stamp === this.mtime) return;
    this.mtime = stamp;
    const read = (f) => {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')).samples || []; } catch { return []; }
    };
    this.samples = [...read(HISTORY), ...read(EXTRA)]
      .map((s) => ({ t: s.t, fh: s.u ? s.u.fh : s.fh, sd: s.u ? s.u.sd : s.sd }))
      .filter((s) => s.t && (s.fh != null || s.sd != null))
      .sort((a, b) => a.t - b.t);
  }

  // 只算 Claude 模型（DeepSeek 等第三方模型不占 Claude 套餐额度）
  claudeRecords() {
    return this.tracker.records.filter((r) => /claude/i.test(r.model)).sort((a, b) => a.t - b.t);
  }

  outputBetween(recs, a, b) {
    let sum = 0;
    for (const r of recs) if (r.t > a && r.t <= b) sum += r.output;
    return sum;
  }

  calibrate(recs) {
    const covered = recs.length ? recs[0].t : Infinity;
    const kw = [];
    const ratio = [];
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      const dsd = (b.sd ?? 0) - (a.sd ?? 0);
      const dfh = (b.fh ?? 0) - (a.fh ?? 0);
      if (dsd >= 1 && dfh >= 1 && b.t - a.t < H5) ratio.push(dfh / dsd);
      if (dsd >= 2 && a.t >= covered) {
        const out = this.outputBetween(recs, a.t, b.t);
        if (out > 2000) kw.push(dsd / out);
      }
    }
    const k = median(kw.slice(-8)) ?? FALLBACK_KW;
    const r = median(ratio.slice(-8)) ?? FALLBACK_RATIO;
    return { kw: k, k5: k * r, calibrated: kw.length > 0 };
  }

  weekWindow(cfg, now) {
    let reset = cfg.weeklyResetAt ? Date.parse(cfg.weeklyResetAt) : NaN;
    if (!isFinite(reset)) return null;
    while (reset <= now) reset += WEEK;
    while (reset - WEEK > now) reset -= WEEK;
    return { start: reset - WEEK, end: reset, exact: true };
  }

  // 5 小时窗口：已知的重置时间优先；之后的窗口从本机第一次请求起算（约）
  fiveHourWindow(cfg, recs, now) {
    const anchor = cfg.fiveHourResetAt ? Date.parse(cfg.fiveHourResetAt) : NaN;
    if (isFinite(anchor) && now < anchor && now >= anchor - H5) return { start: anchor - H5, end: anchor, exact: true };
    let end = isFinite(anchor) ? anchor : 0;
    let win = null;
    for (const r of recs) {
      if (r.t < end) continue;
      const start = ceilMinute(r.t);
      win = { start, end: start + H5, exact: false };
      end = win.end;
    }
    return win && now < win.end ? win : null;
  }

  summary(cfg = {}) {
    this.load();
    const now = Date.now();
    const recs = this.claudeRecords();
    const { kw, k5, calibrated } = this.calibrate(recs);
    const last = this.samples[this.samples.length - 1] || null;

    const estimate = (official, key, k, win) => {
      if (!win) {
        // 没有进行中的窗口：上一个窗口已结束，额度已恢复
        return { used: 0, estimated: false, idle: true };
      }
      const base = last && last.t >= win.start && last[key] != null ? last[key] : 0;
      const from = last && last.t >= win.start ? last.t : win.start;
      const out = this.outputBetween(recs, from, now);
      const extra = k * out;
      const fresh = last && last.t >= win.start && now - last.t < FRESH_MS;
      const estimated = !fresh && extra >= 0.5;
      return { used: Math.min(100, Math.max(0, Math.round(base + extra))), estimated, idle: false };
    };

    const w5 = this.fiveHourWindow(cfg, recs, now);
    const ww = this.weekWindow(cfg, now);
    const five = estimate(last && last.fh, 'fh', k5, w5);
    const week = ww ? estimate(last && last.sd, 'sd', kw, ww) : { used: last ? last.sd ?? null : null, estimated: true };
    const pack = (x, win) => ({
      ...x,
      remaining: x.used == null ? null : 100 - x.used,
      resetAt: win ? win.end : null,
      resetExact: win ? win.exact : false,
    });

    return {
      plan: cfg.planName || '',
      five: pack(five, w5),
      week: pack(week, ww),
      last: last ? { t: last.t, fh: last.fh, sd: last.sd } : null,
      calibrated,
      available: !!last,
    };
  }
}

module.exports = { PlanUsage };
