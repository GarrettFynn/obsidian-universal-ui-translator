// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BatchTranslator } from "../src/core/batch-translator";
import { TranslationProvider } from "../src/providers/base-provider";
import { CacheManager } from "../src/core/cache-manager";
import { TranslationCoordinator } from "../src/core/coordinator";
import { FilterEngine } from "../src/filters/filter-engine";
import { TextFileIO } from "../src/types";

class RecordingProvider extends TranslationProvider {
  readonly id = "rec";
  readonly name = "Recording";
  // A4 后拆批取 min(聚合上限, maxBatchSize)：mock 声明 50 与缺省聚合上限一致（原 1 会把所有批次拆散）；
  // 非 readonly——A4 专项用例需要改小声明值
  maxBatchSize = 50;
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

  it("A4：单批条数上限与 provider.maxBatchSize 取小值——声明 2 时按对拆分", async () => {
    const p = new RecordingProvider();
    p.maxBatchSize = 2; // 模拟声明单请求承载上限为 2 的引擎
    const bt = setup(p, { maxBatchItems: 50 });
    ["A", "B", "C", "D", "E"].forEach((t) => void bt.submit(t));
    await bt.flush();
    expect(p.batches).toEqual([["A", "B"], ["C", "D"], ["E"]]);
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

  it("v1.3 F3：多批 flush 期间逐批上报剩余（状态栏不冻结）", async () => {
    const p = new RecordingProvider();
    const seen: number[] = [];
    const bt = new BatchTranslator(() => p, {
      maxBatchItems: 2,
      onQueueChange: (n) => seen.push(n),
    });
    ["A", "B", "C", "D", "E"].forEach((t) => void bt.submit(t));
    await bt.flush();
    // 5 条拆 3 批（2+2+1）：提交期 1..5，flush 期逐批 3 → 1 → 0
    const settlePhase = seen.slice(5);
    expect(settlePhase).toContain(3);
    expect(settlePhase).toContain(1);
    expect(settlePhase[settlePhase.length - 1]).toBe(0);
    // 逐批不回升（末尾 flush finally 会再补一次 0，允许相等）
    for (let i = 1; i < settlePhase.length; i++) {
      expect(settlePhase[i]).toBeLessThanOrEqual(settlePhase[i - 1]);
    }
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

describe("1.6 E：pendingCount（dom 高峰降级判定源；1.6.0 收尾 b：计入在途批次）", () => {
  it("submit 后计增；flush 结算后归零", async () => {
    const p = new RecordingProvider();
    const bt = setup(p);
    expect(bt.pendingCount()).toBe(0);
    const [a, b] = [bt.submit("A"), bt.submit("B")];
    expect(bt.pendingCount()).toBe(2);
    await bt.flush();
    expect(await a).toBe("译:A");
    expect(await b).toBe("译:B");
    expect(bt.pendingCount()).toBe(0);
  });

  it("同窗口相同文本去重后按去重条数计（共享同一 entry）", async () => {
    const p = new RecordingProvider();
    const bt = setup(p);
    const [x1, x2] = [bt.submit("X"), bt.submit("X")];
    expect(bt.pendingCount()).toBe(1); // byText 去重，queue 只有一条
    void x2;
    await bt.flush();
    expect(await x1).toBe("译:X");
    expect(bt.pendingCount()).toBe(0);
  });

  it("b：flush 在途期间计数不归零（API 未返回时 pendingCount 仍=批次条数），结算后归零", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    class GatedProvider extends RecordingProvider {
      async translateBatch(texts: string[]): Promise<string[]> {
        await gate; // 挂起：模拟批次结算期（API 慢）
        return super.translateBatch(texts);
      }
    }
    const p = new GatedProvider();
    const bt = setup(p);
    const a = bt.submit("Slow text entry");
    const flushing = bt.flush();
    await new Promise((r) => setTimeout(r, 50)); // flush 已取走 entries
    expect(bt.pendingCount()).toBe(1); // 在途计入（原口径此处为 0——复审发现的结构性盲区）
    release();
    await flushing;
    expect(await a).toBe("译:Slow text entry");
    expect(bt.pendingCount()).toBe(0);
  });
});

describe("1.6.0 收尾（b）：在途 >30 时 coordinator 真谓词 throttle 生效", () => {
  it("40 条挂起在途 + 真实装配谓词（pendingCount>30）→ dom/unknown 请求 throttled；效果档不受影响", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    class GatedProvider extends RecordingProvider {
      async translateBatch(texts: string[]): Promise<string[]> {
        await gate;
        return super.translateBatch(texts);
      }
    }
    const provider = new GatedProvider();
    const batcher = new BatchTranslator(() => provider);
    // 真实装配形态（main.ts 口径）：translateVia 走 batcher、shouldThrottleDom 真谓词
    const io: TextFileIO = {
      read: async () => { throw new Error("ENOENT"); },
      write: async () => {},
      exists: async () => false,
    };
    const cache = new CacheManager(io, "cache.json");
    let mode = "efficiency";
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => provider,
      {
        targetLang: "zh-CN",
        glossary: {},
        translateVia: (m: string, c?: string) => batcher.submit(m, c),
        shouldThrottleDom: () => mode === "efficiency" && batcher.pendingCount() > 30,
      }
    );
    // 垫高：40 条互异在途（挂起中）
    const holds: Array<Promise<string>> = [];
    for (let i = 0; i < 40; i++) holds.push(batcher.submit("hold entry text " + i));
    const flushing = batcher.flush();
    await new Promise((r) => setTimeout(r, 50));
    expect(batcher.pendingCount()).toBe(40); // 在途计入
    const DOM_UNKNOWN = { source: "dom" as const, pluginId: "unknown" };
    const r1 = await coordinator.translateWithOutcome("storm victim text", DOM_UNKNOWN);
    expect(r1.outcome).toBe("throttled"); // 真谓词触发——此前仅真机直调可证的链路，单测锁定
    mode = "quality";
    // 发起即完成 throttle 判定（同步段）——先判定后放行，避免 r2 的 submit
    // 等待下次 flush 而下次 flush 又被 flushing 守卫挡到 gate 之后的死锁
    const r2p = coordinator.translateWithOutcome("quality channel text", DOM_UNKNOWN);
    release();
    const r2 = await r2p;
    expect(r2.outcome).not.toBe("throttled"); // 效果档豁免
    await flushing;
    await Promise.allSettled(holds);
  });
});

describe("1.6.0 收尾（b）：多批结算的逐批递减与 queue+inflight 叠加", () => {
  it("maxBatchItems=2 分两批：在途逐批递减；结算期二次 submit 叠加计数", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    class GatedProvider extends RecordingProvider {
      // 第一批挂起（gate），第二批立即返回——锁"逐批递减"中期精度
      seen = 0;
      async translateBatch(texts: string[]): Promise<string[]> {
        this.seen++;
        if (this.seen === 1) await gate;
        return super.translateBatch(texts);
      }
    }
    const p = new GatedProvider();
    const bt = setup(p, { maxBatchItems: 2 });
    const holds = [bt.submit("multi one"), bt.submit("multi two"), bt.submit("multi three")];
    const flushing = bt.flush();
    expect(bt.pendingCount()).toBe(3); // 取走即全部在途（worker 尚未结算任何批次）
    await new Promise((r) => setTimeout(r, 50)); // 第二批（未挂 gate）已结算 → 逐批递减
    expect(bt.pendingCount()).toBe(2); // inflight 3→2：逐批递减的中期精度（冷读 minor 缺口锁定）
    // 结算期（flush 在途）新 submit 进新 queue——R-19 叠加口径：queue + inflight
    const late = bt.submit("late arrival");
    await new Promise((r) => setTimeout(r, 50));
    expect(bt.pendingCount()).toBe(3); // queue 1 + inflight 2
    release(); // 放行第一批；第二批立即结算 → inflight 逐批递减至 0
    await flushing;
    expect(await Promise.all(holds)).toEqual(["译:multi one", "译:multi two", "译:multi three"]);
    expect(bt.pendingCount()).toBeLessThanOrEqual(1); // 仅剩 late 所在窗口（100ms 后自然 flush）
    release = () => {};
    void late.catch(() => undefined); // late 由后续窗口自然结算（测试不阻塞其完成）
    await new Promise((r) => setTimeout(r, 300));
    expect(bt.pendingCount()).toBe(0);
    expect(await late).toBe("译:late arrival");
  });
});
