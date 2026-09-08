import { describe, expect, it } from "vitest";
import { HttpClient, HttpRequest } from "../src/providers/base-provider";
import { GoogleProvider, htmlUnescape, toGoogleLang } from "../src/providers/google-provider";

function captureHttp(status: number, body: unknown, seen: { req?: HttpRequest }): HttpClient {
  return async (req: HttpRequest) => {
    seen.req = req;
    return { status, text: typeof body === "string" ? body : JSON.stringify(body) };
  };
}

describe("GoogleProvider（设计文档 4.3.2）", () => {
  it("q 数组原生批量、key 认证进 URL、translatedText HTML 反转义", async () => {
    const seen: { req?: HttpRequest } = {};
    const http = captureHttp(
      200,
      { data: { translations: [{ translatedText: "打开&lt;设置&gt;" }, { translatedText: "乙" }] } },
      seen
    );
    const p = new GoogleProvider(http, { apiKey: "gk", targetLang: "zh-CN" });
    expect(await p.translateBatch(["One", "Two"])).toEqual(["打开<设置>", "乙"]);
    expect(seen.req!.url).toContain("translation.googleapis.com/language/translate/v2?key=gk");
    const body = JSON.parse(seen.req!.body!);
    expect(body.q).toEqual(["One", "Two"]);
    expect(body.target).toBe("zh-CN");
    expect(body.format).toBe("text");
  });

  it("非 200 响应抛错（含状态码）", async () => {
    const http = captureHttp(403, "forbidden", {});
    const p = new GoogleProvider(http, { apiKey: "bad", targetLang: "zh-CN" });
    await expect(p.translate("hi")).rejects.toThrow("403");
  });
});

describe("辅助函数", () => {
  it("htmlUnescape：常见实体还原，&amp; 最后处理", () => {
    expect(htmlUnescape("A &amp; B &lt;C&gt; &#39;D&#39;")).toBe("A & B <C> 'D'");
  });

  it("toGoogleLang：zh-Hant → zh-TW，其余直传", () => {
    expect(toGoogleLang("zh-Hant")).toBe("zh-TW");
    expect(toGoogleLang("zh-CN")).toBe("zh-CN");
  });
});
