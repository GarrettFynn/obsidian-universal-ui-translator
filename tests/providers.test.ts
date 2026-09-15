import { describe, expect, it } from "vitest";
import { HttpClient, HttpRequest } from "../src/providers/base-provider";
import { OpenAIProvider, parseNumberedResponse } from "../src/providers/openai-provider";
import { CustomProvider, extractByPath } from "../src/providers/custom-provider";

function captureHttp(status: number, body: unknown, seen: { req?: HttpRequest }): HttpClient {
  return async (req: HttpRequest) => {
    seen.req = req;
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  };
}

describe("OpenAIProvider", () => {
  it("请求构造符合 chat/completions 契约并解析译文（去首尾空白）", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(200, { choices: [{ message: { content: " 打开设置 " } }] }, seen);
    const p = new OpenAIProvider(http, { apiKey: "sk-x", targetLang: "zh-CN", model: "gpt-4o-mini" });
    expect(await p.translate("Open Settings")).toBe("打开设置");
    expect(seen.req!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen.req!.headers!["Authorization"]).toBe("Bearer sk-x");
    const body = JSON.parse(seen.req!.body!);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("zh-CN");
    expect(body.messages[body.messages.length - 1].content).toBe("Open Settings");
  });

  it("非 200 响应抛错（错误信息含状态码，供熔断/错误分类）", async () => {
    const http = captureHttp(401, "unauthorized", {});
    const p = new OpenAIProvider(http, { apiKey: "bad", targetLang: "zh-CN" });
    await expect(p.translate("hi")).rejects.toThrow("401");
  });

  it("validateConfig：真实试译探测，200 为 ok 且 401/402/404 分类提示（R-33）", async () => {
    const ok = new OpenAIProvider(
      captureHttp(200, { choices: [{ message: { content: "OK" } }] }, {}),
      { apiKey: "k", targetLang: "zh-CN", model: "m1" }
    );
    const okRes = await ok.validateConfig();
    expect(okRes.ok).toBe(true);
    expect(okRes.message).toContain("m1");
    const bad = new OpenAIProvider(captureHttp(401, "", {}), { apiKey: "k", targetLang: "zh-CN" });
    const res = await bad.validateConfig();
    expect(res.ok).toBe(false);
    expect(res.message).toContain("401");
    const poor = new OpenAIProvider(captureHttp(402, "", {}), { apiKey: "k", targetLang: "zh-CN" });
    const poorRes = await poor.validateConfig();
    expect(poorRes.ok).toBe(false);
    expect(poorRes.message).toContain("余额不足");
    const noModel = new OpenAIProvider(captureHttp(404, "", {}), {
      apiKey: "k",
      targetLang: "zh-CN",
      model: "bad-model",
    });
    const noModelRes = await noModel.validateConfig();
    expect(noModelRes.ok).toBe(false);
    expect(noModelRes.message).toContain("bad-model");
  });

  it("自定义 Base URL 生效（本地模型端点，设计文档 4.3.2）", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(200, { choices: [{ message: { content: "好" } }] }, seen);
    const p = new OpenAIProvider(http, {
      apiKey: "ollama",
      targetLang: "zh-CN",
      baseUrl: "http://localhost:11434/v1/",
    });
    await p.translate("hi");
    expect(seen.req!.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("R-34：disableThinking 开启时请求体注入 thinking.disabled，缺省不注入", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(200, { choices: [{ message: { content: "好" } }] }, seen);
    const on = new OpenAIProvider(http, {
      apiKey: "k",
      targetLang: "zh-CN",
      model: "deepseek-v4-flash",
      disableThinking: true,
    });
    await on.translate("hi");
    expect(JSON.parse(seen.req!.body!).thinking).toEqual({ type: "disabled" });
    const off = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" });
    await off.translate("hi");
    expect(JSON.parse(seen.req!.body!)).not.toHaveProperty("thinking");
  });
});

describe("OpenAIProvider.translateBatch（A1 合批）", () => {
  function batchHttp(content: string | null): { http: HttpClient; seen: { req?: HttpRequest } } {
    const seen: { req?: HttpRequest } = {};
    const http: HttpClient = async (req) => {
      seen.req = req;
      const body =
        content === null ? "not json" : JSON.stringify({ choices: [{ message: { content } }] });
      return { status: 200, text: body };
    };
    return { http, seen };
  }

  it("maxBatchSize 为 40（A1 单请求承载声明）", () => {
    const { http } = batchHttp("");
    expect(new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" }).maxBatchSize).toBe(40);
  });

  it("单行短文本编号合批：一次请求进 N 出 N，顺序保持", async () => {
    const { http, seen } = batchHttp("1. 新建笔记\n2. 打开仓库\n3. 打开设置");
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" });
    expect(await p.translateBatch(["New note", "Open vault", "Open Settings"])).toEqual([
      "新建笔记",
      "打开仓库",
      "打开设置",
    ]);
    const body = JSON.parse(seen.req!.body!);
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[body.messages.length - 1].content).toBe("1. New note\n2. Open vault\n3. Open Settings");
    expect(body.messages[0].content).toContain("EXACTLY 3 lines");
  });

  it("多行 / 超长（>200 字符）条目不进批，走单条通道；混合输入顺序保持", async () => {
    const seenReqs: HttpRequest[] = [];
    const http: HttpClient = async (req) => {
      seenReqs.push(req);
      const body = JSON.parse(req.body!);
      const last = body.messages[body.messages.length - 1].content as string;
      // 合批请求（编号列表）与单条请求（纯文本）由内容形态区分
      const isBatch = /^\d+\. /m.test(last);
      const content = isBatch ? "1. 短" : "单条译文";
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) };
    };
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" });
    const multi = "第一行\n第二行";
    const long = "x".repeat(201);
    expect(await p.translateBatch(["Short", multi, long])).toEqual(["短", "单条译文", "单条译文"]);
    // 1 次合批（仅 Short）+ 2 次单条
    expect(seenReqs).toHaveLength(3);
  });

  it("响应行数不符 / 序号错位 / 格式不符 → 抛错（整批降级拆单由上游兜底）", async () => {
    const { http } = batchHttp("1. 甲\n2. 乙");
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" });
    await expect(p.translateBatch(["A", "B", "C"])).rejects.toThrow("行数不符");
    expect(() => parseNumberedResponse("1. 甲\n1. 乙", 2)).toThrow("序号错位");
    expect(() => parseNumberedResponse("甲\n乙", 2)).toThrow("格式不符");
    expect(() => parseNumberedResponse("2. 乙\n1. 甲", 2)).not.toThrow(); // 乱序但集合完整：可还原
    expect(parseNumberedResponse("1. 甲\n2. 乙", 2)).toEqual(["甲", "乙"]);
  });

  it("disableThinking 注入合批请求体", async () => {
    const { http, seen } = batchHttp("1. 好");
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN", disableThinking: true });
    await p.translateBatch(["hi"]);
    expect(JSON.parse(seen.req!.body!).thinking).toEqual({ type: "disabled" });
  });

  it("非批条目单条失败不拖垮整批：失败位留空槽（undefined），其余正常返回", async () => {
    const calls: string[] = [];
    const http: HttpClient = async (req) => {
      const body = JSON.parse(req.body!);
      const last = body.messages[body.messages.length - 1].content as string;
      calls.push(last);
      const isBatch = /^\d+\. /m.test(last);
      if (!isBatch) return { status: 401, text: "unauthorized" }; // 单条通道失败
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "1. 好" } }] }) };
    };
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" });
    const res = await p.translateBatch(["ok", "第一行\n第二行"]);
    expect(res[0]).toBe("好");
    expect(res[1]).toBeUndefined(); // 空槽：由上游 runBatch 触发该条的单条重试
  });

  it("空数组直接返回空", async () => {
    const { http } = batchHttp("");
    const p = new OpenAIProvider(http, { apiKey: "k", targetLang: "zh-CN" });
    expect(await p.translateBatch([])).toEqual([]);
  });

  it("v1.3：响应携带 usage 时 onUsage 回传真实 token（单条与合批两路径）", async () => {
    const usages: Array<{ promptTokens: number; completionTokens: number }> = [];
    const http: HttpClient = async (req) => {
      const body = JSON.parse(req.body!);
      const last = body.messages[body.messages.length - 1].content as string;
      const isBatch = /^\d+\. /m.test(last);
      return {
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: isBatch ? "1. 好\n2. 吧" : "好" } }],
          usage: { prompt_tokens: 320, completion_tokens: 24 },
        }),
      };
    };
    const p = new OpenAIProvider(http, {
      apiKey: "k",
      targetLang: "zh-CN",
      onUsage: (u) => usages.push(u),
    });
    await p.translate("hi");
    expect(usages).toEqual([{ promptTokens: 320, completionTokens: 24 }]);
    await p.translateBatch(["a", "b"]);
    expect(usages).toHaveLength(2);
    expect(usages[1]).toEqual({ promptTokens: 320, completionTokens: 24 });
  });

  it("v1.3：网关缺 usage 或字段非数字时静默跳过（不估算、不抛错）", async () => {
    const usages: unknown[] = [];
    const mk = (usage: unknown): HttpClient =>
      async (req) => ({
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: JSON.parse(req.body!).messages ? "好" : "好" } }],
          ...(usage === undefined ? {} : { usage }),
        }),
      });
    for (const bad of [undefined, { prompt_tokens: "320" }, {}, null]) {
      const p = new OpenAIProvider(mk(bad), {
        apiKey: "k",
        targetLang: "zh-CN",
        onUsage: (u) => usages.push(u),
      });
      await p.translate("hi"); // 不抛错即通过
    }
    expect(usages).toHaveLength(0);
  });
});

describe("CustomProvider", () => {
  it("按模板构造请求体并按 responsePath 提取译文", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(200, { result: { translation: ["译文"] } }, seen);
    const p = new CustomProvider(http, {
      targetLang: "zh-CN",
      endpoint: "http://localhost:8080/translate",
      requestTemplate: "{\"q\":\"{{text}}\",\"to\":\"{{targetLang}}\"}",
      responsePath: "result.translation.0",
    });
    expect(await p.translate("Open Settings")).toBe("译文");
    expect(JSON.parse(seen.req!.body!)).toEqual({ q: "Open Settings", to: "zh-CN" });
  });

  it("extractByPath：点路径与数组下标", () => {
    const data = { a: { b: [{ c: "x" }] } };
    expect(extractByPath(data, "a.b.0.c")).toBe("x");
    expect(extractByPath(data, "a.b.1.c")).toBeNull();
    expect(extractByPath(data, "a.b.0")).toBeNull(); // 指向对象而非字符串：不返回（仅字符串契约）
    expect(extractByPath({ a: 1 }, "a")).toBeNull(); // 非字符串不返回
  });
});
