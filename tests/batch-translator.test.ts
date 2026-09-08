import { describe, expect, it } from "vitest";
import { BatchTranslator } from "../src/core/batch-translator";
import { TranslationProvider } from "../src/providers/base-provider";

class RecordingProvider extends TranslationProvider {
  readonly id = "rec";
  readonly name = "Recording";
  readonly maxBatchSize = 1;
  batches: string[][] = [];
  singles: string[] = [];
  batchFailures = 0;
  failSingleTexts = new Set<string>();

  async translate(text: string): Promise<string> {
    this.singles.push(text);
    if (this.failSingleTexts.has(text)) throw new Error(`fail:${text}`);
    return "译:" + text;
  }

  async translateBatch(texts: string[]): Promise<string[]> {
    this.batches.push([...texts]);
    if (this.batchFailures > 0) {
      this.batchFailures--;
      throw new Error("batch boom");
    }
    return texts.map((t) => "译:" + t);
  }

  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "ok" };
  }
}

function setup(provider: RecordingProvider | null, options = {}) {
  return new BatchTranslator(() => provider, options);
}

describe("BatchTranslator（设计文档 4.2.2）", () => {
  it("窗口内多条文本合并为一次批量请求", async () => {
    const p = new RecordingProvider();
    const bt = setup(p);
    const [a, b, c] = [bt.submit("A"), bt.submit("B"), bt.submit("C")];
    await bt.flush();
    expect(await a).toBe("译:A");
    expect(await c).toBe("译:C");
    expect(p.batches).toEqual([["A", "B", "C"]]);
    expect(p.singles).toHaveLength(0);
    void b;
  });

  it("窗口内相同文本去重共享同一请求", async () => {
    const p = new RecordingProvider();
    const bt = setup(p);
    const [x1, x2] = [bt.submit("X"), bt.submit("X")];
    await bt.flush();
    expect(await x1).toBe("译:X");
    expect(await x2).toBe("译:X");
    expect(p.batches).toEqual([["X"]]);
  });

  it("单批条数上限拆分", async () => {
    const p = new RecordingProvider();
    const bt = setup(p, { maxBatchItems: 2 });
    ["A", "B", "C"].forEach((t) => void bt.submit(t));
    await bt.flush();
    expect(p.batches).toEqual([["A", "B"], ["C"]]);
  });

  it("单批字符上限拆分", async () => {
    const p = new RecordingProvider();
    const bt = setup(p, { maxBatchChars: 5 });
    ["AAA", "BBB", "CC"].forEach((t) => void bt.submit(t));
    await bt.flush();
    expect(p.batches).toEqual([["AAA"], ["BBB", "CC"]]);
  });

  it("批量失败 → 拆单条重试 1 次成功", async () => {
    const p = new RecordingProvider();
    p.batchFailures = 1;
    const bt = setup(p);
    const [a, b] = [bt.submit("A"), bt.submit("B")];
    await bt.flush();
    expect(await a).toBe("译:A");
    expect(await b).toBe("译:B");
    expect(p.singles).toEqual(["A", "B"]); // 拆单条重试各一次
  });

  it("stats：提交/成功/失败去重计数（v1.1.0 状态栏进度）", async () => {
    const p = new RecordingProvider();
    p.batchFailures = 1; // 批量整体失败 → 拆单条
    p.failSingleTexts.add("C");
    const bt = setup(p);
    const [a, , c] = [
      bt.submit("A"),
      bt.submit("A"), // 去重：同文本共享，不重复计数
      bt.submit("C").catch(() => "failed"),
    ];
    await bt.flush();
    expect(await a).toBe("译:A");
    expect(await c).toBe("failed");
    expect(bt.stats()).toEqual({ submitted: 2, completed: 1, failed: 1 });
  });

  it("单条重试仍失败 → 该条 reject，其余正常（不无限重试）", async () => {
    const p = new RecordingProvider();
    p.batchFailures = 1;
    p.failSingleTexts.add("BAD");
    const bt = setup(p);
    const good = bt.submit("GOOD");
    const bad = bt.submit("BAD");
    await bt.flush();
    expect(await good).toBe("译:GOOD");
    await expect(bad).rejects.toThrow("fail:BAD");
    expect(p.singles.filter((t) => t === "BAD")).toHaveLength(1); // 只重试 1 次
  });

  it("Provider 未配置时立即 reject（由调用方回退原文）", async () => {
    const bt = setup(null);
    await expect(bt.submit("A")).rejects.toThrow("Provider 未配置");
  });

  it("flush 后窗口重置，可继续聚合新批次", async () => {
    const p = new RecordingProvider();
    const bt = setup(p);
    void bt.submit("A");
    await bt.flush();
    void bt.submit("B");
    await bt.flush();
    expect(p.batches).toEqual([["A"], ["B"]]);
  });

  it("onQueueChange：提交与结算时回调队列深度（O-1 进度提示）", async () => {
    const p = new RecordingProvider();
    const seen: number[] = [];
    const bt = new BatchTranslator(() => p, { onQueueChange: (n) => seen.push(n) });
    void bt.submit("A");
    void bt.submit("B");
    await bt.flush();
    expect(seen[0]).toBe(1);
    expect(seen[1]).toBe(2);
    expect(seen[seen.length - 1]).toBe(0); // 结算归零
  });

  it("4xx 批量失败不拆单条重试（4.2.2 错误分类，E-03）", async () => {
    const p = new RecordingProvider();
    p.translateBatch = function (this: RecordingProvider, texts: string[]): Promise<string[]> {
      this.batches.push([...texts]);
      return Promise.reject(new Error("DeepL HTTP 401: unauthorized"));
    };
    const bt = setup(p);
    const a = bt.submit("A");
    await bt.flush();
    await expect(a).rejects.toThrow("401");
    expect(p.singles).toHaveLength(0); // 未拆单条重试
  });

  it("R-19 回归：在途 flush 期间的新提交在结算后重排窗口（不滞留、不归零失效）", async () => {
    const p = new RecordingProvider();
    let release: () => void = () => undefined;
    p.translateBatch = function (this: RecordingProvider, texts: string[]): Promise<string[]> {
      this.batches.push([...texts]);
      // 后续批次（重排窗口的尾巴）正常结算
      if (this.batches.length > 1) {
        return Promise.resolve(texts.map((t) => "译:" + t));
      }
      // 首个批量请求挂起，模拟慢引擎在途（实测单条 9.26s 的场景）
      return new Promise((r) => {
        release = () => r(texts.map((t) => "译:" + t));
      });
    };
    const bt = new BatchTranslator(() => p, { windowMs: 10 });
    const a = bt.submit("A");
    await new Promise((r) => setTimeout(r, 30)); // 窗口触发，首个 flush 在途挂起
    const b = bt.submit("B"); // 在途期间提交（R-19 复现条件）
    await new Promise((r) => setTimeout(r, 50)); // 尾巴窗口触发，flush 早退
    release(); // 首个 flush 结算
    await new Promise((r) => setTimeout(r, 200)); // 重排窗口 + 第二次 flush
    expect(await a).toBe("译:A");
    expect(await b).toBe("译:B");
    expect(p.batches).toEqual([["A"], ["B"]]);
  });
});
