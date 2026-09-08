import { describe, expect, it } from "vitest";
import { HttpClient, HttpRequest } from "../src/providers/base-provider";
import { DeepLProvider, toDeepLLang } from "../src/providers/deepl-provider";

function captureHttp(status: number, body: unknown, seen: { req?: HttpRequest }): HttpClient {
  return async (req: HttpRequest) => {
    seen.req = req;
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  };
}

describe("DeepLProvider（设计文档 4.3.2）", () => {
  it("Free/Pro 端点按 Key 后缀自动识别", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(200, { translations: [{ text: "好" }] }, seen);
    const free = new DeepLProvider(http, { apiKey: "abc:fx", targetLang: "zh-CN" });
    await free.translate("hi");
    expect(seen.req!.url).toBe("https://api-free.deepl.com/v2/translate");
    const pro = new DeepLProvider(http, { apiKey: "abc", targetLang: "zh-CN" });
    await pro.translate("hi");
    expect(seen.req!.url).toBe("https://api.deepl.com/v2/translate");
  });

  it("原生批量：单请求携带多条 text，认证头与语言映射正确", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(
      200,
      { translations: [{ text: "甲" }, { text: "乙" }] },
      seen
    );
    const p = new DeepLProvider(http, { apiKey: "k:fx", targetLang: "zh-CN" });
    expect(await p.translateBatch(["One", "Two"])).toEqual(["甲", "乙"]);
    expect(seen.req!.headers!["Authorization"]).toBe("DeepL-Auth-Key k:fx");
    const body = JSON.parse(seen.req!.body!);
    expect(body.text).toEqual(["One", "Two"]);
    expect(body.target_lang).toBe("ZH-HANS");
  });

  it("响应条数与请求不符时抛错（防错位回写）", async () => {
    const http = captureHttp(200, { translations: [{ text: "甲" }] }, {});
    const p = new DeepLProvider(http, { apiKey: "k:fx", targetLang: "zh-CN" });
    await expect(p.translateBatch(["One", "Two"])).rejects.toThrow("数量与请求不符");
  });

  it("validateConfig：200 为 ok，403 为 fail", async () => {
    const ok = new DeepLProvider(captureHttp(200, {}, {}), { apiKey: "k:fx", targetLang: "zh-CN" });
    expect((await ok.validateConfig()).ok).toBe(true);
    const bad = new DeepLProvider(captureHttp(403, "", {}), { apiKey: "k:fx", targetLang: "zh-CN" });
    expect((await bad.validateConfig()).ok).toBe(false);
  });
});

describe("toDeepLLang", () => {
  it("zh-CN → ZH-HANS，zh-Hant → ZH-HANT，其余大写直传", () => {
    expect(toDeepLLang("zh-CN")).toBe("ZH-HANS");
    expect(toDeepLLang("zh-Hant")).toBe("ZH-HANT");
    expect(toDeepLLang("ja")).toBe("JA");
  });
});
