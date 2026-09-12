import { describe, expect, it } from "vitest";
import { TranslationCoordinator } from "../src/core/coordinator";
import { CacheManager } from "../src/core/cache-manager";
import { FilterEngine } from "../src/filters/filter-engine";
import { TranslationProvider } from "../src/providers/base-provider";
import { TextFileIO } from "../src/types";

class MemoryIO implements TextFileIO {
  files = new Map<string, string>();
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error("ENOENT");
    return v;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

class StubProvider extends TranslationProvider {
  readonly id = "stub";
  readonly name = "Stub";
  readonly maxBatchSize = 1;
  calls: string[] = [];
  behavior: (text: string) => string = (t) => "译:" + t;
  failTimes = 0;
  async translate(text: string): Promise<string> {
    this.calls.push(text);
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new Error("boom");
    }
    return this.behavior(text);
  }
  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "ok" };
  }
}

const CTX = { source: "command" as const, pluginId: "test-plugin" };

function setup(opts?: {
  glossary?: Record<string, string>;
  provider?: StubProvider | null;
  now?: () => number;
  onCircuitOpen?: () => void;
}) {
  const provider = opts?.provider === undefined ? new StubProvider() : opts.provider;
  const cache = new CacheManager(new MemoryIO(), "cache.json");
  const coordinator = new TranslationCoordinator(
    new FilterEngine(),
    cache,
    () => provider,
    { targetLang: "zh-CN", glossary: opts?.glossary ?? {} },
    opts?.now,
    opts?.onCircuitOpen
  );
  return { coordinator, cache, provider };
}

describe("TranslationCoordinator 数据流（设计文档 3.2）", () => {
  it("过滤链拒绝的文本直放原文，不调 Provider", async () => {
    const { coordinator, provider } = setup();
    expect(await coordinator.translate("42", CTX)).toBe("42");
    expect((provider as StubProvider).calls).toHaveLength(0);
  });

  it("术语表命中直接返回固定译法，不调 Provider（FR-15）", async () => {
    const { coordinator, provider } = setup({ glossary: { "Open Settings": "开启设置" } });
    expect(await coordinator.translate("Open Settings", CTX)).toBe("开启设置");
    expect((provider as StubProvider).calls).toHaveLength(0);
  });

  it("缓存命中零网络请求（设计文档测试用例 1）", async () => {
    const { coordinator, cache, provider } = setup();
    const key = CacheManager.makeKey("Open Settings", "stub", "zh-CN", "");
    cache.set(key, {
      src: "Open Settings", tgt: "打开设置", provider: "stub",
      lang: "zh-CN", from: "", hits: 0, updatedAt: 1,
    });
    expect(await coordinator.translate("Open Settings", CTX)).toBe("打开设置");
    expect((provider as StubProvider).calls).toHaveLength(0);
  });

  it("cacheEnabled=off 时不读不写缓存，直调 Provider（v1.1.5 死配置接线）", async () => {
    const provider = new StubProvider();
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    // 预置一条本可命中的缓存
    const key = CacheManager.makeKey("Open Settings", "stub", "zh-CN", "");
    cache.set(key, {
      src: "Open Settings", tgt: "缓存译文", provider: "stub",
      lang: "zh-CN", from: "", hits: 0, updatedAt: Date.now(),
    });
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => provider,
      { targetLang: "zh-CN", glossary: {}, isCacheEnabled: () => false }
    );
    // 缓存有货也不读：直调 Provider
    expect(await coordinator.translate("Open Settings", CTX)).toBe("译:Open Settings");
    expect(provider.calls).toEqual(["Open Settings"]);
    // 新译文不写缓存
    expect(await coordinator.translate("New Label", CTX)).toBe("译:New Label");
    expect(cache.stats().size).toBe(1); // 仍只有预置那一条
  });

  it("未命中走 Provider 并写缓存；第二次调用直接命中", async () => {
    const { coordinator, provider } = setup();
    expect(await coordinator.translate("Open Settings", CTX)).toBe("译:Open Settings");
    expect(await coordinator.translate("Open Settings", CTX)).toBe("译:Open Settings");
    expect((provider as StubProvider).calls).toHaveLength(1);
  });

  it("占位符被吞时回退原文且不写缓存（设计文档测试用例 10）", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "个项目"; // 占位符 __UUTPH0__ 被 LLM 吃掉
    const { coordinator, cache } = setup({ provider: stub });
    expect(await coordinator.translate("{0} items", CTX)).toBe("{0} items");
    const key = CacheManager.makeKey("{0} items", "stub", "zh-CN", "");
    expect(cache.get(key)).toBeNull(); // 残缺译文不落盘
  });

  it("失败文本 5 分钟负缓存：期间同文本不再请求（设计文档测试用例 11）", async () => {
    const stub = new StubProvider();
    stub.failTimes = 100;
    const { coordinator } = setup({ provider: stub });
    expect(await coordinator.translate("Some Label", CTX)).toBe("Some Label");
    expect(await coordinator.translate("Some Label", CTX)).toBe("Some Label");
    expect(stub.calls).toHaveLength(1);
  });

  it("连续 5 次失败触发熔断：回调一次，熔断期内不再请求", async () => {
    const stub = new StubProvider();
    stub.failTimes = 100;
    let circuitNotices = 0;
    const { coordinator } = setup({ provider: stub, onCircuitOpen: () => circuitNotices++ });
    for (let i = 0; i < 5; i++) {
      await coordinator.translate(`Label Number ${i}`, CTX);
    }
    expect(circuitNotices).toBe(1);
    expect(coordinator.isCircuitOpen()).toBe(true);
    await coordinator.translate("Another Label", CTX);
    expect(stub.calls).toHaveLength(5); // 熔断期内未发起新请求
  });

  it("resetFailures：熔断与负缓存立即复位——修好配置后无需重启（v1.1.0 热生效）", async () => {
    const stub = new StubProvider();
    stub.failTimes = 100;
    const { coordinator } = setup({ provider: stub });
    for (let i = 0; i < 5; i++) {
      await coordinator.translate(`Label Number ${i}`, CTX);
    }
    expect(coordinator.isCircuitOpen()).toBe(true);
    stub.failTimes = 0; // 模拟用户修好配置
    coordinator.resetFailures();
    expect(coordinator.isCircuitOpen()).toBe(false);
    // 负缓存已清：此前失败的文本立即重译成功
    expect(await coordinator.translate("Label Number 0", CTX)).toBe("译:Label Number 0");
  });

  it("Provider 未配置时回退原文（4.4.2 未配置行为）", async () => {
    const { coordinator } = setup({ provider: null });
    expect(await coordinator.translate("Open Settings", CTX)).toBe("Open Settings");
  });

  it("配置 translateVia 时经批量通道送译，不直调 provider（4.2.2）", async () => {
    const stub = new StubProvider();
    const via: string[] = [];
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => stub,
      {
        targetLang: "zh-CN",
        glossary: {},
        translateVia: async (m) => {
          via.push(m);
          return "批:" + m;
        },
      }
    );
    expect(await coordinator.translate("Open Settings", CTX)).toBe("批:Open Settings");
    expect(via).toEqual(["Open Settings"]);
    expect(stub.calls).toHaveLength(0);
  });

  it("月度预算超限时不送译、回退原文（4.5 预算熔断）", async () => {
    const stub = new StubProvider();
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => stub,
      {
        targetLang: "zh-CN",
        glossary: {},
        usageTracker: {
          record: async () => undefined,
          isOverBudget: async () => true,
        },
        monthlyCharBudget: 1,
      }
    );
    expect(await coordinator.translate("Open Settings", CTX)).toBe("Open Settings");
    expect(stub.calls).toHaveLength(0);
  });

  it("翻译成功后按送译字符记录用量（4.5）", async () => {
    const stub = new StubProvider();
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const recorded: number[] = [];
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => stub,
      {
        targetLang: "zh-CN",
        glossary: {},
        usageTracker: {
          record: async (n) => {
            recorded.push(n);
          },
          isOverBudget: async () => false,
        },
        monthlyCharBudget: null,
      }
    );
    expect(await coordinator.translate("Open Settings", CTX)).toBe("译:Open Settings");
    expect(recorded).toEqual(["Open Settings".length]);
    // 缓存命中不重复计量
    expect(await coordinator.translate("Open Settings", CTX)).toBe("译:Open Settings");
    expect(recorded).toHaveLength(1);
  });

  it("Key 失效（401）立即提示一次且不重复（4.2.2 错误分类，E-03）", async () => {
    const stub = new StubProvider();
    stub.behavior = () => {
      throw new Error("OpenAI HTTP 401: unauthorized");
    };
    let notices = 0;
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => stub,
      { targetLang: "zh-CN", glossary: {}, onAuthFailure: () => notices++ }
    );
    await coordinator.translate("First Label", CTX);
    await coordinator.translate("Second Label", CTX);
    expect(notices).toBe(1);
  });
});

describe("translateWithOutcome 结果分类（v1.1.8：手动通道区分「无待译」与「失败」）", () => {
  it("translated / cache / glossary / filtered / no-provider 各自归类", async () => {
    const { coordinator, provider } = setup({ glossary: { "Open Settings": "开启设置" } });
    const r1 = await coordinator.translateWithOutcome("Brand New Label", CTX);
    expect(r1).toEqual({ text: "译:Brand New Label", outcome: "translated" });
    // 第二次调用命中缓存
    const r2 = await coordinator.translateWithOutcome("Brand New Label", CTX);
    expect(r2).toEqual({ text: "译:Brand New Label", outcome: "cache" });
    expect((provider as StubProvider).calls).toHaveLength(1);
    // 术语表
    expect((await coordinator.translateWithOutcome("Open Settings", CTX)).outcome).toBe("glossary");
    // 过滤链
    expect((await coordinator.translateWithOutcome("42", CTX)).outcome).toBe("filtered");
    // 未配置 Provider
    const np = setup({ provider: null });
    const r3 = await np.coordinator.translateWithOutcome("Some Label", CTX);
    expect(r3).toEqual({ text: "Some Label", outcome: "no-provider" });
  });

  it("budget：超限归类、不送译，onBudgetExceeded 每会话只触发一次", async () => {
    const stub = new StubProvider();
    let notices = 0;
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      new CacheManager(new MemoryIO(), "cache.json"),
      () => stub,
      {
        targetLang: "zh-CN",
        glossary: {},
        usageTracker: { record: async () => undefined, isOverBudget: async () => true },
        monthlyCharBudget: 1,
        onBudgetExceeded: () => notices++,
      }
    );
    const r1 = await coordinator.translateWithOutcome("Open Settings", CTX);
    expect(r1).toEqual({ text: "Open Settings", outcome: "budget" });
    await coordinator.translateWithOutcome("Another Label", CTX);
    expect(notices).toBe(1); // 第二次超限不再重复提示
    expect(stub.calls).toHaveLength(0);
  });

  it("failed 携带错误摘要；TTL 内同文本归类 negative-cache；连续失败归类 circuit", async () => {
    const stub = new StubProvider();
    stub.behavior = () => {
      throw new Error("OpenAI HTTP 429: slow down");
    };
    const { coordinator } = setup({ provider: stub });
    const r1 = await coordinator.translateWithOutcome("Some Label", CTX);
    expect(r1.outcome).toBe("failed");
    expect(r1.text).toBe("Some Label"); // 回退原文不变
    expect(r1.error).toContain("HTTP 429");
    // 负缓存：5 分钟内同文本不重试
    const r2 = await coordinator.translateWithOutcome("Some Label", CTX);
    expect(r2.outcome).toBe("negative-cache");
    expect(stub.calls).toHaveLength(1);
    // 再失败 4 次（累计连续 5 次）→ 熔断
    for (let i = 0; i < 4; i++) {
      await coordinator.translateWithOutcome(`Label Number ${i}`, CTX);
    }
    const r3 = await coordinator.translateWithOutcome("Fresh Label", CTX);
    expect(r3.outcome).toBe("circuit");
    expect(stub.calls).toHaveLength(5); // 熔断期内未发起新请求
  });

  it("bypassNegativeCache：手动点击在负缓存 TTL 内强制重试（熔断/预算不受影响）", async () => {
    const stub = new StubProvider();
    stub.failTimes = 1; // 第一次失败，之后成功
    const { coordinator } = setup({ provider: stub });
    expect((await coordinator.translateWithOutcome("Some Label", CTX)).outcome).toBe("failed");
    // 默认路径：TTL 内被负缓存拦截
    expect((await coordinator.translateWithOutcome("Some Label", CTX)).outcome).toBe(
      "negative-cache"
    );
    expect(stub.calls).toHaveLength(1);
    // 手动点击通道：绕过负缓存立即重试并成功
    const r = await coordinator.translateWithOutcome("Some Label", CTX, {
      bypassNegativeCache: true,
    });
    expect(r).toEqual({ text: "译:Some Label", outcome: "translated" });
    expect(stub.calls).toHaveLength(2);
  });

  it("占位符被改写归类 failed 且不回写缓存（4.2.1 规则 6 闭环）", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "个项目"; // 占位符 __UUTPH0__ 被 LLM 吃掉
    const { coordinator, cache } = setup({ provider: stub });
    const r = await coordinator.translateWithOutcome("{0} items", CTX);
    expect(r.outcome).toBe("failed");
    expect(r.error).toBe("译文占位符被改写");
    const key = CacheManager.makeKey("{0} items", "stub", "zh-CN", "");
    expect(cache.get(key)).toBeNull();
  });
});
