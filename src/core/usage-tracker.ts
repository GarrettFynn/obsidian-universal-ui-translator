import { TextFileIO } from "../types";

/** 单日用量桶（v1.1.9 用量统计分页）：calls=送译条数，in/outChars=输入/输出字符 */
export interface DayUsage {
  calls: number;
  inChars: number;
  outChars: number;
}

interface UsageFile {
  month: string; // 'YYYY-MM'
  chars: number;
  /** v1.1.9：逐日明细；旧版本文件无此字段，视为空 */
  days?: Record<string, DayUsage>;
}

/** 逐日明细保留天数（图表只展示近 30 天，多留一月余量；超出剪枝控制文件体积） */
const DAY_RETENTION = 62;

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
          this.days.set(k, { calls: v.calls | 0, inChars: v.inChars | 0, outChars: v.outChars | 0 });
        }
      }
      this.pruneDays();
    } catch {
      // 损坏文件视为零用量
    }
  }

  /** 记录本次送译字符数并落盘；outChars 为译文长度（v1.1.9 逐日明细） */
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
    const sum: DayUsage = { calls: 0, inChars: 0, outChars: 0 };
    for (const [k, v] of this.days) {
      if (!k.startsWith(prefix)) continue;
      sum.calls += v.calls;
      sum.inChars += v.inChars;
      sum.outChars += v.outChars;
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
