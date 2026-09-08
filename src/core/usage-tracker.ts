import { TextFileIO } from "../types";

interface UsageFile {
  month: string; // 'YYYY-MM'
  chars: number;
}

/**
 * 用量统计与月度预算（设计文档 4.5 API Tab / 9.3 成本控制）
 * - 按月累计已发送字符数，持久化 usage.json；跨月自动清零
 * - 超预算时 isOverBudget() 为 true，Coordinator 暂停送译回退原文（4.5 超限熔断）
 * - 落盘失败静默（不影响翻译主流程）
 */
export class UsageTracker {
  private month = "";
  private chars = 0;
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
    } catch {
      // 损坏文件视为零用量
    }
  }

  /** 记录本次送译字符数并落盘 */
  async record(chars: number): Promise<void> {
    await this.load();
    if (this.month !== this.currentMonth()) {
      this.month = this.currentMonth();
      this.chars = 0; // 跨月自动清零
    }
    this.chars += chars;
    try {
      await this.io.write(
        this.filePath,
        JSON.stringify({ month: this.month, chars: this.chars })
      );
    } catch {
      // 落盘失败不影响翻译主流程
    }
  }

  /** 本月已发送字符数 */
  async monthChars(): Promise<number> {
    await this.load();
    return this.month === this.currentMonth() ? this.chars : 0;
  }

  /** 是否超出月度预算（budget 为 null 表示不限） */
  async isOverBudget(budget: number | null): Promise<boolean> {
    if (budget === null) return false;
    return (await this.monthChars()) >= budget;
  }
}
