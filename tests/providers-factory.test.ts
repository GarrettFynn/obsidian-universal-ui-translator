import { describe, expect, it } from "vitest";
import { createActiveProvider } from "../src/providers";
import { KeyStorage } from "../src/core/key-storage";
import { HttpClient } from "../src/providers/base-provider";
import { DEFAULT_SETTINGS, PluginSettings, TextFileIO } from "../src/types";

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

const http: HttpClient = async () => ({ status: 200, text: "{}" });

function settingsWith(partial: Partial<PluginSettings>): PluginSettings {
  return Object.assign({}, DEFAULT_SETTINGS, partial);
}

describe("createActiveProvider（设计文档 4.4.2 未配置行为）", () => {
  it("OpenAI 缺 Key 返回 null", async () => {
    const ks = new KeyStorage(new MemoryIO(), "s.bin");
    expect(await createActiveProvider(settingsWith({ activeProvider: "openai" }), ks, http)).toBeNull();
  });

  it("OpenAI 有 Key 构建实例；Custom 缺端点返回 null", async () => {
    const ks = new KeyStorage(new MemoryIO(), "s.bin");
    await ks.set("openai", "sk-x");
    const p = await createActiveProvider(settingsWith({ activeProvider: "openai" }), ks, http);
    expect(p?.id).toBe("openai");
    expect(await createActiveProvider(settingsWith({ activeProvider: "custom" }), ks, http)).toBeNull();
  });

  it("Custom 端点齐备时构建实例", async () => {
    const ks = new KeyStorage(new MemoryIO(), "s.bin");
    const s = settingsWith({
      activeProvider: "custom",
      providers: {
        custom: { apiBaseUrl: "http://localhost:11434/v1/chat/completions", model: "qwen2.5" },
      },
    });
    const p = await createActiveProvider(s, ks, http);
    expect(p?.id).toBe("custom");
  });

  it("DeepL / Google 有 Key 即构建；缺 Key 返回 null", async () => {
    const ks = new KeyStorage(new MemoryIO(), "s.bin");
    expect(await createActiveProvider(settingsWith({ activeProvider: "deepl" }), ks, http)).toBeNull();
    await ks.set("deepl", "k:fx");
    await ks.set("google", "gk");
    expect((await createActiveProvider(settingsWith({ activeProvider: "deepl" }), ks, http))?.id).toBe("deepl");
    expect((await createActiveProvider(settingsWith({ activeProvider: "google" }), ks, http))?.id).toBe("google");
  });

  it("Azure 需 Key + Region 齐备，缺一返回 null", async () => {
    const ks = new KeyStorage(new MemoryIO(), "s.bin");
    await ks.set("azure", "ak");
    expect(
      await createActiveProvider(settingsWith({ activeProvider: "azure" }), ks, http)
    ).toBeNull();
    const s = settingsWith({
      activeProvider: "azure",
      providers: { azure: { region: "eastasia" } },
    });
    expect((await createActiveProvider(s, ks, http))?.id).toBe("azure");
  });
});
