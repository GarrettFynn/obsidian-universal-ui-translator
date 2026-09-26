// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DOMPatcher } from "../../src/interceptors/dom-patcher";
import { TranslationCoordinator } from "../../src/core/coordinator";
import { CacheManager } from "../../src/core/cache-manager";
import { FilterEngine } from "../../src/filters/filter-engine";
import { TranslationProvider } from "../../src/providers/base-provider";
import type { TextFileIO } from "../../src/types";

/**
 * 嵌套防线泛化回归（Spike 2 转正，1.4 批次一）：
 * 真实全链路 DOMPatcher（jsdom）→ 真实 TranslationCoordinator（真实 FilterEngine +
 * 内存 CacheManager + StubProvider 回译映射）。rescanAllText() 清账本全量重扫后，
 * ja 双语括号产物必须被 5c 泛化拦截——provider 调用数增量为 0（零重送 = 零重复扣费
 * 与零嵌套再翻）。zh 为既有 5c 行为的对照。
 * 基建与 tests/integration/dom-patcher.test.ts 同构（jsdom docblock + wait +
 * tests/__mocks__/obsidian.ts 别名由根 vitest.config.ts 提供）。
 */

// ---------- 基建 ----------

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

/** 回译映射 stub provider：源文命中映射返回译文；未命中（= 双语产物被重送）返回
 *  N(...) 模拟 LLM 对已译文本的再加工——嵌套乱码的发生机制 */
class StubProvider extends TranslationProvider {
  readonly id = "stub";
  readonly name = "Stub";
  readonly maxBatchSize = 1;
  calls: string[] = [];
  constructor(private map: Record<string, string>) {
    super();
  }
  async translate(text: string): Promise<string> {
    this.calls.push(text);
    return this.map[text] ?? `N(${text})`;
  }
  async validateConfig(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "ok" };
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 双语括号回写格式（display-mode {t} ({o})，Spike 2 实证的 P0 泄漏形态） */
const format = (t: string, o: string) => (t === o ? null : `${t} (${o})`);

interface Rig {
  patcher: DOMPatcher;
  provider: StubProvider;
  divs: HTMLDivElement[];
}

async function setupRig(lang: string, map: Record<string, string>): Promise<Rig> {
  const provider = new StubProvider(map);
  const coordinator = new TranslationCoordinator(
    new FilterEngine([], lang),
    new CacheManager(new MemoryIO(), "cache.json"),
    () => provider,
    { targetLang: lang, glossary: {} }
  );
  const patcher = new DOMPatcher(coordinator, format, () => false);
  patcher.activate();
  const divs: HTMLDivElement[] = [];
  for (const src of Object.keys(map)) {
    const div = document.createElement("div");
    div.textContent = src;
    document.body.appendChild(div);
    divs.push(div);
  }
  await wait(300); // jsdom 无 requestIdleCallback → setTimeout(100) 兜底
  return { patcher, provider, divs };
}

// ---------- 断言主体 ----------

describe("嵌套防线泛化：rescanAllText 零重送（Spike 2 转正）", () => {
  const patchers: DOMPatcher[] = [];
  afterEach(() => {
    for (const p of patchers.splice(0)) p.deactivate();
    document.body.innerHTML = "";
  });

  it("ja：双语括号产物重扫后 provider 调用数增量为 0（5c 泛化 P0 修复本体）", async () => {
    const map: Record<string, string> = {
      // 前 2 条纯译文（假名形态）+ 后 2 条混合译文（规则 5b 的假名盲区样本）
      "Open settings": "設定を開く",
      "New tab": "新しいタブ",
      "Export to PDF": "PDF をエクスポート",
      "Open Web page": "Web ページを開く",
    };
    const rig = await setupRig("ja", map);
    patchers.push(rig.patcher);
    // 首轮：英文原文全部送译（纯/混合译文是回写后才出现在 DOM 的）
    expect(rig.provider.calls).toEqual(Object.keys(map));

    rig.patcher.rescanAllText();
    await wait(400);
    // 双语括号产物被 5c（ja 区间）拦截：零重送
    expect(rig.provider.calls.length).toBe(Object.keys(map).length);
    // DOM 保持首轮译文形态，未被 N(...) 嵌套再加工
    expect(rig.divs[0].textContent).toBe("設定を開く (Open settings)");
    expect(rig.divs[2].textContent).toBe("PDF をエクスポート (Export to PDF)");
  }, 15000);

  it("zh 对照：双语括号产物重扫后 provider 调用数增量为 0（v1.1.5 行为保持）", async () => {
    const map: Record<string, string> = {
      "Open settings": "打开设置",
      "New tab": "新建标签页",
      "Copy URL": "复制 URL",
    };
    const rig = await setupRig("zh-CN", map);
    patchers.push(rig.patcher);
    expect(rig.provider.calls).toEqual(Object.keys(map));

    rig.patcher.rescanAllText();
    await wait(400);
    expect(rig.provider.calls.length).toBe(Object.keys(map).length);
    expect(rig.divs[2].textContent).toBe("复制 URL (Copy URL)");
  }, 15000);
});
