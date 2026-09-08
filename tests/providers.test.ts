import { describe, expect, it } from "vitest";
import { HttpClient, HttpRequest } from "../src/providers/base-provider";
import { OpenAIProvider } from "../src/providers/openai-provider";
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
