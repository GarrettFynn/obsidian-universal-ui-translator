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

  it("B1：来源版本变化（Obsidian/插件升级）后同文本仍命中，零重译（D5 推翻）", async () => {
    const { coordinator, cache, provider } = setup();
    const key = CacheManager.makeKey("Open Settings", "stub", "zh-CN", "");
    // 模拟旧版本来源写入的存量条目（v1.1.x 格式，from 为 core@appVersion）
    cache.set(key, {
      src: "Open Settings", tgt: "打开设置", provider: "stub",
      lang: "zh-CN", from: "core@1.9.0", hits: 3, updatedAt: 1,
    });
    expect(await coordinator.translate("Open Settings", CTX)).toBe("打开设置");
    expect((provider as StubProvider).calls).toHaveLength(0); // 升级不再触发全量重译
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
    // 1.6 C3 双探测：键已 masked 化——原文键与 masked 键都必须为空（防单探测空转通过）
    const keyOrig = CacheManager.makeKey("{0} items", "stub", "zh-CN", "");
    expect(cache.get(keyOrig)).toBeNull(); // 残缺译文不落盘
    const keyMasked = CacheManager.makeKey("__UUTPH0__ items", "stub", "zh-CN", "");
    expect(cache.get(keyMasked)).toBeNull();
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
    // 1.6 C3 负缓存按 masked 键：标签须互异且不含数字/占位符——同模板共享 masked 键会被负缓存拦截
    const labels = ["Label Alpha", "Label Beta", "Label Gamma", "Label Delta", "Label Epsilon"];
    for (const label of labels) {
      await coordinator.translate(label, CTX);
    }
    expect(circuitNotices).toBe(1);
    expect(coordinator.isCircuitOpen()).toBe(true);
    await coordinator.translate("Another Label", CTX);
    expect(stub.calls).toHaveLength(5); // 熔断期内未发起新请求
  });

  it("A3：429 限流不计入熔断——连续限流不触发 10 分钟全停（负缓存仍生效）", async () => {
    const stub = new StubProvider();
    stub.behavior = () => {
      throw new Error("OpenAI HTTP 429: rate limited");
    };
    let circuitNotices = 0;
    const { coordinator } = setup({ provider: stub, onCircuitOpen: () => circuitNotices++ });
    // 1.6 C3 负缓存按 masked 键：标签互异且不含数字（同模板会被负缓存拦截、凑不满计数）
    const rateLabels = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"].map(
      (w) => `Rate Label ${w}`
    );
    for (const label of rateLabels) {
      await coordinator.translate(label, CTX);
    }
    expect(circuitNotices).toBe(0);
    expect(coordinator.isCircuitOpen()).toBe(false);
    expect(stub.calls).toHaveLength(8); // 未熔断：每条新文本仍尝试（同文本受 5 分钟负缓存约束）
  });

  it("resetFailures：熔断与负缓存立即复位——修好配置后无需重启（v1.1.0 热生效）", async () => {
    const stub = new StubProvider();
    stub.failTimes = 100;
    const { coordinator } = setup({ provider: stub });
    // 1.6 C3 负缓存按 masked 键：标签互异且不含数字
    const failLabels = ["Label Alpha", "Label Beta", "Label Gamma", "Label Delta", "Label Epsilon"];
    for (const label of failLabels) {
      await coordinator.translate(label, CTX);
    }
    expect(coordinator.isCircuitOpen()).toBe(true);
    stub.failTimes = 0; // 模拟用户修好配置
    coordinator.resetFailures();
    expect(coordinator.isCircuitOpen()).toBe(false);
    // 负缓存已清：此前失败的文本立即重译成功
    expect(await coordinator.translate("Label Alpha", CTX)).toBe("译:Label Alpha");
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
    const recorded: Array<[number, number?]> = [];
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => stub,
      {
        targetLang: "zh-CN",
        glossary: {},
        usageTracker: {
          record: async (n, out) => {
            recorded.push([n, out]);
          },
          isOverBudget: async () => false,
        },
        monthlyCharBudget: null,
      }
    );
    expect(await coordinator.translate("Open Settings", CTX)).toBe("译:Open Settings");
    // v1.1.9：第二参为译文长度（用量统计分页输入/输出拆分）
    expect(recorded).toEqual([["Open Settings".length, "译:Open Settings".length]]);
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

  it("failed 携带错误摘要；TTL 内同文本归类 negative-cache；连续失败归类 circuit（v1.2 A3 起 429 不计熔断，改用 500 刺激）", async () => {
    const stub = new StubProvider();
    stub.behavior = () => {
      throw new Error("OpenAI HTTP 500: server error");
    };
    const { coordinator } = setup({ provider: stub });
    const r1 = await coordinator.translateWithOutcome("Some Label", CTX);
    expect(r1.outcome).toBe("failed");
    expect(r1.text).toBe("Some Label"); // 回退原文不变
    expect(r1.error).toContain("HTTP 500");
    // 负缓存：5 分钟内同文本不重试
    const r2 = await coordinator.translateWithOutcome("Some Label", CTX);
    expect(r2.outcome).toBe("negative-cache");
    expect(stub.calls).toHaveLength(1);
    // 再失败 4 次（累计连续 5 次）→ 熔断（1.6 C3 负缓存按 masked 键：标签互异且不含数字）
    for (const label of ["Label Alpha", "Label Beta", "Label Gamma", "Label Delta"]) {
      await coordinator.translateWithOutcome(label, CTX);
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
    // 1.6 C3 双探测：原文键与 masked 键都必须为空
    expect(cache.get(CacheManager.makeKey("{0} items", "stub", "zh-CN", ""))).toBeNull();
    expect(cache.get(CacheManager.makeKey("__UUTPH0__ items", "stub", "zh-CN", ""))).toBeNull();
  });
});

describe("1.5 F3：cacheOnly 模式（弹窗重开自动回写专用）", () => {
  it("未命中返回原文 + outcome cache-miss，不调 Provider", async () => {
    const { coordinator, provider } = setup();
    const r = await coordinator.translateWithOutcome("brand new text", CTX, { cacheOnly: true });
    expect(r.outcome).toBe("cache-miss");
    expect(r.text).toBe("brand new text");
    expect((provider as StubProvider).calls).toHaveLength(0);
  });
  it("命中返回缓存译文（先正常翻译入缓存，再 cacheOnly 同文本）", async () => {
    const { coordinator } = setup();
    await coordinator.translateWithOutcome("cached text", CTX);
    const r = await coordinator.translateWithOutcome("cached text", CTX, { cacheOnly: true });
    expect(r.outcome).toBe("cache");
    expect(r.text).toBe("译:cached text");
  });
});

describe("1.5 B3：宽松缓存键（跨模型/引擎复用译文）", () => {
  it("isLooseCacheKey 开启：换模型后同文本命中缓存，不再调 Provider", async () => {
    const provider = new StubProvider();
    let model = "model-a";
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => provider,
      {
        targetLang: "zh-CN",
        glossary: {},
        getModelId: () => model,
        isLooseCacheKey: () => true,
      }
    );
    const r1 = await coordinator.translateWithOutcome("shared text", CTX);
    expect(r1.outcome).toBe("translated");
    model = "model-b"; // 换模型：严格键下必 miss，宽松键下命中
    const r2 = await coordinator.translateWithOutcome("shared text", CTX);
    expect(r2.outcome).toBe("cache");
    expect(provider.calls.length).toBe(1); // 只调了一次 API
  });
});

describe("1.6 C：数字归一化缓存（maskAll 单趟联合 token 化）", () => {
  it("数字模板 masked 键：540/1234 与 541/1234 同键命中，各自还原正确数字", async () => {
    const { coordinator, provider } = setup();
    const r1 = await coordinator.translateWithOutcome("New preset: 540/1234", CTX);
    expect(r1).toEqual({ text: "译:New preset: 540/1234", outcome: "translated" });
    // 送译的正是 masked（数字已 token 化）
    expect((provider as StubProvider).calls).toEqual(["New preset: __UUTPH0__/__UUTPH1__"]);
    const r2 = await coordinator.translateWithOutcome("New preset: 541/1234", CTX);
    expect(r2).toEqual({ text: "译:New preset: 541/1234", outcome: "cache" });
    expect((provider as StubProvider).calls).toHaveLength(1); // 模板只付一次钱
  });

  it("数字 + 显式占位符混排：单趟联合 token 化，往返无损", async () => {
    const { coordinator } = setup();
    const r = await coordinator.translateWithOutcome("{0} of 5 items", CTX);
    expect(r.text).toBe("译:{0} of 5 items");
  });

  it("模型吞数字 token：还原校验拦截，回退原文且 masked 键不写缓存", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "第 __UUTPH0__ 页"; // 第二个 token 被吞
    const { coordinator, cache } = setup({ provider: stub });
    const r = await coordinator.translateWithOutcome("Page 5 of 10", CTX);
    expect(r.outcome).toBe("failed");
    expect(r.text).toBe("Page 5 of 10");
    expect(cache.get(CacheManager.makeKey("Page __UUTPH0__ of __UUTPH1__", "stub", "zh-CN", ""))).toBeNull();
  });

  it("模型幻觉 token（多出 __UUTPH5__）：还原校验拦截", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "译:__UUTPH0__ of __UUTPH1__ __UUTPH5__";
    const { coordinator } = setup({ provider: stub });
    const r = await coordinator.translateWithOutcome("Page 5 of 10", CTX);
    expect(r.outcome).toBe("failed");
  });

  it("模型把数字直接译出（token 全丢）：还原校验拦截——同模板跨缓存串数字的根因场景", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "译:新预设：540/1234"; // 首见值直出、无 token
    const { coordinator } = setup({ provider: stub });
    const r = await coordinator.translateWithOutcome("New preset: 540/1234", CTX);
    expect(r.outcome).toBe("failed");
    expect(r.text).toBe("New preset: 540/1234");
  });

  it("负缓存按 masked 键：同模板失败一次后变体不再请求", async () => {
    const stub = new StubProvider();
    stub.failTimes = 100;
    const { coordinator } = setup({ provider: stub });
    expect((await coordinator.translateWithOutcome("Page 5 of 10", CTX)).outcome).toBe("failed");
    expect((await coordinator.translateWithOutcome("Page 6 of 10", CTX)).outcome).toBe(
      "negative-cache"
    );
    expect(stub.calls).toHaveLength(1);
  });

  it("宽松键 × 含数字文本：跨模型命中 masked 键并按当前原文还原", async () => {
    const provider = new StubProvider();
    let model = "model-a";
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => provider,
      { targetLang: "zh-CN", glossary: {}, getModelId: () => model, isLooseCacheKey: () => true }
    );
    await coordinator.translateWithOutcome("Page 5 of 10", CTX);
    model = "model-b"; // 换模型：宽松键下 masked 命中
    const r = await coordinator.translateWithOutcome("Page 6 of 10", CTX);
    expect(r.outcome).toBe("cache");
    expect(r.text).toBe("译:Page 6 of 10"); // 数字按当前原文还原，不是首见的 5
    expect(provider.calls.length).toBe(1);
  });

  it("无数字无占位符文本 masked === 原文：缓存行为与 1.5 完全一致", async () => {
    const { coordinator, provider } = setup();
    await coordinator.translateWithOutcome("Open Settings", CTX);
    const r = await coordinator.translateWithOutcome("Open Settings", CTX);
    expect(r.outcome).toBe("cache");
    expect(r.text).toBe("译:Open Settings");
    expect((provider as StubProvider).calls).toHaveLength(1);
  });
});

describe("1.6 E：dom 高峰降级（效率档 + pluginId 甄别）", () => {
  function setupT(shouldThrottleDom?: () => boolean) {
    const provider = new StubProvider();
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      new CacheManager(new MemoryIO(), "cache.json"),
      () => provider,
      { targetLang: "zh-CN", glossary: {}, shouldThrottleDom }
    );
    return { coordinator, provider };
  }
  const DOM_UNKNOWN = { source: "dom" as const, pluginId: "unknown" };
  const DOM_MKT = { source: "dom" as const, pluginId: "marketplace" };

  it("效率档 + 超阈 + dom+unknown：throttled 不发 API；解除后同文本正常送译（不进负缓存）", async () => {
    let throttle = true;
    const { coordinator, provider } = setupT(() => throttle);
    const r = await coordinator.translateWithOutcome("Some Label", DOM_UNKNOWN);
    expect(r).toEqual({ text: "Some Label", outcome: "throttled" });
    expect(provider.calls).toHaveLength(0);
    throttle = false; // 队列深度回落
    const r2 = await coordinator.translateWithOutcome("Some Label", DOM_UNKNOWN);
    expect(r2.outcome).toBe("translated");
    expect(provider.calls).toHaveLength(1);
  });

  it("pluginId=marketplace 不降级（市场手动「译」是主动通道，审查 H4 甄别）", async () => {
    const { coordinator, provider } = setupT(() => true);
    const r = await coordinator.translateWithOutcome("Some Label", DOM_MKT);
    expect(r.outcome).toBe("translated");
    expect(provider.calls).toHaveLength(1);
  });

  it("menu 等其他 source 不受影响", async () => {
    const { coordinator, provider } = setupT(() => true);
    const r = await coordinator.translateWithOutcome("Some Label", {
      source: "menu",
      pluginId: "x",
    });
    expect(r.outcome).toBe("translated");
    expect(provider.calls).toHaveLength(1);
  });

  it("cacheOnly 请求永不返回 throttled（先于 throttle 分支返回 cache-miss）", async () => {
    const { coordinator } = setupT(() => true);
    const r = await coordinator.translateWithOutcome("Some Label", DOM_UNKNOWN, {
      cacheOnly: true,
    });
    expect(r.outcome).toBe("cache-miss");
  });

  it("无 shouldThrottleDom（效果优先缺省）永不触发", async () => {
    const { coordinator, provider } = setupT(undefined);
    const r = await coordinator.translateWithOutcome("Some Label", DOM_UNKNOWN);
    expect(r.outcome).toBe("translated");
    expect(provider.calls).toHaveLength(1);
  });
});

describe("1.6 F：成本审计日志", () => {
  it("开启时送译打 console 明细（[UUT] 前缀 + source + 字符数）；关闭时静默", async () => {
    const { vi } = await import("vitest");
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    try {
      const provider = new StubProvider();
      const mk = (audit: boolean) =>
        new TranslationCoordinator(
          new FilterEngine(),
          new CacheManager(new MemoryIO(), "cache.json"),
          () => provider,
          { targetLang: "zh-CN", glossary: {}, isCostAuditLog: () => audit }
        );
      await mk(true).translateWithOutcome("Brand New Label", CTX);
      expect(logs).toHaveLength(1);
      expect(logs[0][0]).toBe("[UUT]");
      expect(logs[0][1]).toBe("command"); // ctx.source
      expect(logs[0][3]).toBe("Brand New Label".length); // masked.length（无数字 = 原文长度）
      await mk(false).translateWithOutcome("Another Label", CTX);
      expect(logs).toHaveLength(1); // 关闭时不新增
    } finally {
      spy.mockRestore();
    }
  });
});

describe("1.6 复审补强：还原校验违例的抑制护栏", () => {
  it("违例译文进负缓存：同模板变体 5 分钟内不再全价送译（复审 #1）", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "第 __UUTPH0__ 页"; // 吞第二个 token：持续违例
    const { coordinator } = setup({ provider: stub });
    expect((await coordinator.translateWithOutcome("Page 5 of 10", CTX)).outcome).toBe("failed");
    expect((await coordinator.translateWithOutcome("Page 6 of 10", CTX)).outcome).toBe(
      "negative-cache"
    );
    expect(stub.calls).toHaveLength(1); // 变体被 masked 负缓存拦截，未重付
  });

  it("连续 5 次异模板违例触发熔断：质量故障计入钱包护栏", async () => {
    const stub = new StubProvider();
    stub.behavior = () => "残缺 __UUTPH9__"; // 幻觉 token：恒违例
    let circuitNotices = 0;
    const { coordinator } = setup({ provider: stub, onCircuitOpen: () => circuitNotices++ });
    const labels = ["Alpha page", "Beta page", "Gamma page", "Delta page", "Epsilon page"];
    for (const label of labels) {
      const r = await coordinator.translateWithOutcome(`${label} of 10 items`, CTX);
      expect(r.outcome).toBe("failed");
    }
    expect(circuitNotices).toBe(1); // 第 5 次违例触发熔断
    expect(coordinator.isCircuitOpen()).toBe(true);
  });

  it("cacheOnly × 缓存命中但条目残缺：fall-through 成 cache-miss，零 API（复审 #2 语义锁定）", async () => {
    const stub = new StubProvider();
    const cache = new CacheManager(new MemoryIO(), "cache.json");
    const coordinator = new TranslationCoordinator(
      new FilterEngine(),
      cache,
      () => stub,
      { targetLang: "zh-CN", glossary: {} }
    );
    // 预置残缺条目：tgt 缺第二个 token（模拟旧版本写入的残缺译文）
    const maskedKey = CacheManager.makeKey("Page __UUTPH0__ of __UUTPH1__", "stub", "zh-CN", "");
    cache.set(maskedKey, {
      src: "Page 5 of 10", tgt: "第 __UUTPH0__ 页", provider: "stub",
      lang: "zh-CN", model: "", hits: 0, updatedAt: 1,
    });
    const r = await coordinator.translateWithOutcome("Page 7 of 20", CTX, { cacheOnly: true });
    expect(r.outcome).toBe("cache-miss"); // 违例不触发 API：被 cacheOnly 分支拦下
    expect(r.text).toBe("Page 7 of 20");
    expect(stub.calls).toHaveLength(0);
  });
});
