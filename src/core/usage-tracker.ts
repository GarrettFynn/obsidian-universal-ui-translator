import { TextFileIO } from "../types";

/** 单日用量桶（v1.1.9 用量统计分页）：calls=送译条数，in/outChars=输入/输出字符；
 *  v1.3：in/outTokens 为 API 上报的真实账单口径 token（旧文件/无 usage 网关缺省视为 0） */
export interface DayUsage {
  calls: number;
  inChars: number;
  outChars: number;
  inTokens?: number;
  outTokens?: number;
}

interface UsageFile {
  month: string; // 'YYYY-MM'
  chars: number;
  /** v1.1.9：逐日明细；旧版本文件无此字段，视为空 */
  days?: Record<string, DayUsage>;
}

/** 逐日明细保留天数（图表只展示近 30 天，多留一月余量；超出剪枝控制文件体积） */
const DAY_RETENTION = 62;

/** v1.2 B4：record 落盘去抖间隔（内存累加，≥5s 且有变化才写盘；崩溃最多丢 5s 统计） */
const WRITE_DEBOUNCE_MS = 5000;

/** v1.3：速率环形窗口参数——保留 10 分钟（最长 5 分钟窗口 + 余量），容量硬顶防御 */
const RECENT_WINDOW_MS = 10 * 60 * 1000;
const RECENT_MAX_ENTRIES = 2000;

/** v1.3：速率窗口条目（仅内存不落盘） */
interface RecentEntry {
  at: number;
  tokens: number;
  chars: number;
}

/**
 * 用量统计与月度预算（设计文档 4.5 API Tab / 9.3 成本控制）
 * - 按月累计已发送字符数，持久化 usage.json；跨月自动清零（月度预算判定口径，v1.1.9 不变）
 * - v1.1.9：新增逐日明细（送译条数 + 输入/输出字符）供「用量统计」分页图表；
 *   日桶独立于月份字段（跨月保留，图表要画近 30 天），只留近 62 天
 * - 超预算时 isOverBudget() 为 true，Coordinator 暂停送译回退原文（4.5 超限熔断）
 * - 落盘失败静默（不影响翻译主流程）
 */
export class UsageTracker {
  private month = "";
  private chars = 0;
  private days = new Map<string, DayUsage>();
  private loaded = false;
  private writeTimer: number | null = null;
  /** v1.3：速率环形窗口（仅内存）与会话级计数 */
  private recent: RecentEntry[] = [];
  private sessionTokens = 0;
  private sessionChars = 0;
  private sessionCalls = 0;
  private peakTokensPerMin = 0;

  constructor(
    private io: TextFileIO,
    private filePath: string,
    private now: () => Date = () => new Date()
  ) {}

  private currentMonth(): string {
    const d = this.now();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  private dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!(await this.io.exists(this.filePath))) return;
    try {
      const raw = JSON.parse(await this.io.read(this.filePath)) as UsageFile;
      if (raw.month === this.currentMonth()) {
        this.chars = raw.chars | 0;
        this.month = raw.month;
      }
      // 逐日明细不受跨月清零影响（图表跨月画近 30 天）
      for (const [k, v] of Object.entries(raw.days ?? {})) {
        if (typeof v?.calls === "number") {
          this.days.set(k, {
            calls: v.calls | 0,
            inChars: v.inChars | 0,
            outChars: v.outChars | 0,
            // v1.3：token 实测字段透传（旧文件缺省视为 0）
            ...(typeof v.inTokens === "number" ? { inTokens: v.inTokens } : {}),
            ...(typeof v.outTokens === "number" ? { outTokens: v.outTokens } : {}),
          });
        }
      }
      this.pruneDays();
    } catch {
      // 损坏文件视为零用量
    }
  }

  /**
   * 记录本次送译字符数（outChars 为译文长度，v1.1.9 逐日明细）
   * v1.2 B4：内存累加 + 去抖落盘（原每条翻译全量重写一次 usage.json，500 条 = 500 次写盘）；
   * 预算判定读内存不受影响；崩溃最多丢一个去抖间隔的统计
   */
  async record(chars: number, outChars = 0): Promise<void> {
    await this.load();
    if (this.month !== this.currentMonth()) {
      this.month = this.currentMonth();
      this.chars = 0; // 跨月自动清零
    }
    this.chars += chars;
    const key = this.dayKey(this.now());
    const day = this.days.get(key) ?? { calls: 0, inChars: 0, outChars: 0 };
    day.calls++;
    day.inChars += chars;
    day.outChars += outChars;
    this.days.set(key, day);
    this.pruneDays();
    this.pushRecent({ at: this.now().getTime(), tokens: 0, chars });
    this.sessionChars += chars;
    this.sessionCalls++;
    this.scheduleWrite();
  }

  /**
   * v1.3：记录一次请求 API 上报的真实 token（账单口径；合批一次调用即整批消耗）
   * 与 record 同一去抖落盘路径，日桶按 in/out 分档（费用估算按档计价）
   */
  async recordTokens(promptTokens: number, completionTokens: number): Promise<void> {
    await this.load();
    const key = this.dayKey(this.now());
    const day = this.days.get(key) ?? { calls: 0, inChars: 0, outChars: 0 };
    day.inTokens = (day.inTokens ?? 0) + promptTokens;
    day.outTokens = (day.outTokens ?? 0) + completionTokens;
    this.days.set(key, day);
    this.pushRecent({
      at: this.now().getTime(),
      tokens: promptTokens + completionTokens,
      chars: 0,
    });
    this.sessionTokens += promptTokens + completionTokens;
    this.scheduleWrite();
  }

  /** v1.3：窗口内每分钟消耗速率；windowMs ≤ 60s 时顺带刷新峰值（供会话卡片展示） */
  ratePerMinute(windowMs: number): { tokensPerMin: number; charsPerMin: number } {
    const cutoff = this.now().getTime() - windowMs;
    let tokens = 0;
    let chars = 0;
    for (const e of this.recent) {
      if (e.at < cutoff) continue;
      tokens += e.tokens;
      chars += e.chars;
    }
    const scale = windowMs / 60_000;
    const rate = { tokensPerMin: tokens / scale, charsPerMin: chars / scale };
    if (windowMs <= 60_000) {
      this.peakTokensPerMin = Math.max(this.peakTokensPerMin, rate.tokensPerMin);
    }
    return rate;
  }

  /** v1.3：今日用量（in/out token 拆分——费用按档计价）；异步确保日桶已加载 */
  async todayUsage(): Promise<{ inTokens: number; outTokens: number; chars: number }> {
    await this.load();
    const day = this.days.get(this.dayKey(this.now()));
    return {
      inTokens: day?.inTokens ?? 0,
      outTokens: day?.outTokens ?? 0,
      chars: day ? day.inChars : 0,
    };
  }

  /** v1.3：会话级统计（自插件加载起） */
  sessionStats(): { tokens: number; chars: number; calls: number; peakTokensPerMin: number } {
    return {
      tokens: this.sessionTokens,
      chars: this.sessionChars,
      calls: this.sessionCalls,
      peakTokensPerMin: this.peakTokensPerMin,
    };
  }

  /** v1.3：最近一次活动时间戳（ms；无活动为 null）——状态栏空闲隐藏判定用 */
  lastActivityAt(): number | null {
    return this.recent.length > 0 ? this.recent[this.recent.length - 1].at : null;
  }

  /** 速率窗口追加 + 懒剪枝（>10 分钟）+ 容量硬顶（防御性） */
  private pushRecent(e: RecentEntry): void {
    this.recent.push(e);
    const cutoff = e.at - RECENT_WINDOW_MS;
    while (this.recent.length > 0 && this.recent[0].at < cutoff) this.recent.shift();
    if (this.recent.length > RECENT_MAX_ENTRIES) {
      this.recent.splice(0, this.recent.length - RECENT_MAX_ENTRIES);
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer !== null) return;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      void this.persist();
    }, WRITE_DEBOUNCE_MS);
  }

  /** v1.2 B4：立即落盘（去抖兜底；onunload 调用） */
  async flush(): Promise<void> {
    if (this.writeTimer !== null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await this.io.write(
        this.filePath,
        JSON.stringify({ month: this.month, chars: this.chars, days: Object.fromEntries(this.days) })
      );
    } catch {
      // 落盘失败不影响翻译主流程
    }
  }

  /** 本月已发送字符数（月度预算判定口径） */
  async monthChars(): Promise<number> {
    await this.load();
    return this.month === this.currentMonth() ? this.chars : 0;
  }

  /** v1.1.9：本月日桶合计（送译条数/输入/输出字符；逐日明细自 v1.1.9 起记录，历史月份无明细） */
  async monthStats(): Promise<DayUsage> {
    await this.load();
    const prefix = this.currentMonth();
    const sum: DayUsage = { calls: 0, inChars: 0, outChars: 0, inTokens: 0, outTokens: 0 };
    for (const [k, v] of this.days) {
      if (!k.startsWith(prefix)) continue;
      sum.calls += v.calls;
      sum.inChars += v.inChars;
      sum.outChars += v.outChars;
      sum.inTokens = (sum.inTokens ?? 0) + (v.inTokens ?? 0);
      sum.outTokens = (sum.outTokens ?? 0) + (v.outTokens ?? 0);
    }
    return sum;
  }

  /** v1.1.9：近 N 天逐日明细（缺日补零、按日期升序——图表连续 X 轴） */
  async dailyStats(days = 30): Promise<Array<{ date: string } & DayUsage>> {
    await this.load();
    const out: Array<{ date: string } & DayUsage> = [];
    const base = this.now();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const key = this.dayKey(d);
      const v = this.days.get(key);
      out.push({
        date: key,
        calls: v?.calls ?? 0,
        inChars: v?.inChars ?? 0,
        outChars: v?.outChars ?? 0,
        inTokens: v?.inTokens ?? 0,
        outTokens: v?.outTokens ?? 0,
      });
    }
    return out;
  }

  /** 是否超出月度预算（budget 为 null 表示不限） */
  async isOverBudget(budget: number | null): Promise<boolean> {
    if (budget === null) return false;
    return (await this.monthChars()) >= budget;
  }

  /** 日桶剪枝：只保留近 DAY_RETENTION 天（YYYY-MM-DD 字典序即时间序） */
  private pruneDays(): void {
    const base = this.now();
    const oldest = this.dayKey(
      new Date(base.getFullYear(), base.getMonth(), base.getDate() - (DAY_RETENTION - 1))
    );
    for (const k of [...this.days.keys()]) {
      if (k < oldest) this.days.delete(k);
    }
  }
}
