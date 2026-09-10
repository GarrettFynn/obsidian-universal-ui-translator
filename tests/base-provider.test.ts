// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TranslationProvider, withTimeout } from "../src/providers/base-provider";

class EchoProvider extends TranslationProvider {
  readonly id = "echo";
  readonly name = "Echo";
  readonly maxBatchSize = 1;
  calls: string[] = [];
  async translate(text: string): Promise<string> {
    this.calls.push(text);
    return text.toUpperCase();
  }
  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "ok" };
  }
}

describe("TranslationProvider.translateBatch 默认实现", () => {
  it("受控并发逐条翻译，返回顺序与输入一致", async () => {
    const p = new EchoProvider();
    const input = ["a", "b", "c", "d", "e", "f", "g"];
    expect(await p.translateBatch(input)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(p.calls).toHaveLength(7);
  });

  it("空数组返回空数组", async () => {
    expect(await new EchoProvider().translateBatch([])).toEqual([]);
  });
});

describe("withTimeout（4.2.2 / R-23 超时包装）", () => {
  it("正常解析时透传结果", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "测试")).resolves.toBe("ok");
  });

  it("超时后 reject（调用方按失败处理）", async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, "翻译请求")).rejects.toThrow(
      "超时"
    );
  });
});
