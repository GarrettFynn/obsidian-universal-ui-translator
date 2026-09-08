import { describe, expect, it } from "vitest";
import { HttpClient, HttpRequest } from "../src/providers/base-provider";
import { AzureProvider, toAzureLang } from "../src/providers/azure-provider";

function captureHttp(status: number, body: unknown, seen: { req?: HttpRequest }): HttpClient {
  return async (req: HttpRequest) => {
    seen.req = req;
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  };
}

describe("AzureProvider（设计文档 4.3.2）", () => {
  it("[{Text}] 数组原生批量、Key+Region 双认证头、to 参数语言映射", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(
      200,
      [{ translations: [{ text: "甲" }] }, { translations: [{ text: "乙" }] }],
      seen
    );
    const p = new AzureProvider(http, { apiKey: "ak", region: "eastasia", targetLang: "zh-CN" });
    expect(await p.translateBatch(["One", "Two"])).toEqual(["甲", "乙"]);
    expect(seen.req!.url).toContain("api.cognitive.microsofttranslator.com/translate");
    expect(seen.req!.url).toContain("to=zh-Hans");
    expect(seen.req!.headers!["Ocp-Apim-Subscription-Key"]).toBe("ak");
    expect(seen.req!.headers!["Ocp-Apim-Subscription-Region"]).toBe("eastasia");
    expect(JSON.parse(seen.req!.body!)).toEqual([{ Text: "One" }, { Text: "Two" }]);
  });

  it("响应条数与请求不符时抛错", async () => {
    const http = captureHttp(200, [{ translations: [{ text: "甲" }] }], {});
    const p = new AzureProvider(http, { apiKey: "ak", region: "r", targetLang: "zh-CN" });
    await expect(p.translateBatch(["One", "Two"])).rejects.toThrow("不符");
  });

  it("toAzureLang：zh-CN → zh-Hans，zh-Hant 直传", () => {
    expect(toAzureLang("zh-CN")).toBe("zh-Hans");
    expect(toAzureLang("zh-Hant")).toBe("zh-Hant");
  });
});
