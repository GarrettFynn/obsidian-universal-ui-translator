import { describe, expect, it } from "vitest";
import { KeyStorage, SafeStorageLike } from "../src/core/key-storage";
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

// 模拟 safeStorage：machineId 前缀充当"本机可逆加密"；machineId 不匹配则解密失败
function fakeSafeStorage(machineId: string): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(machineId + "|" + plain, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const s = encrypted.toString("utf8");
      if (!s.startsWith(machineId + "|")) throw new Error("decrypt failed");
      return s.slice(machineId.length + 1);
    },
  };
}

const PATH = "secrets.bin";

describe("KeyStorage", () => {
  it("加密可用时安全往返（含模拟重启后重载）", async () => {
    const io = new MemoryIO();
    const ks = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    expect(ks.isEncryptionAvailable()).toBe(true);
    await ks.set("openai", "sk-test-123");
    const ks2 = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    expect(await ks2.get("openai")).toBe("sk-test-123");
  });

  it("无 safeStorage 时降级混淆存储并明示非加密", async () => {
    const io = new MemoryIO();
    const ks = new KeyStorage(io, PATH);
    expect(ks.isEncryptionAvailable()).toBe(false);
    await ks.set("deepl", "key-abc");
    const raw = JSON.parse(io.files.get(PATH)!) as { encrypted: boolean };
    expect(raw.encrypted).toBe(false);
    const ks2 = new KeyStorage(io, PATH);
    expect(await ks2.get("deepl")).toBe("key-abc");
  });

  it("密文同步到其他设备时解密失败：丢弃条目并计数（设计文档 4.4.1）", async () => {
    const io = new MemoryIO();
    const ks = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    await ks.set("openai", "sk-test-123");
    // 模拟换机：machine-b 解不开 machine-a 的密文
    const ks2 = new KeyStorage(io, PATH, fakeSafeStorage("machine-b"));
    expect(await ks2.get("openai")).toBeNull();
    expect(ks2.hasDecryptFailures()).toBe(true);
  });

  it("删除后持久化，重载不可见", async () => {
    const io = new MemoryIO();
    const ks = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    await ks.set("openai", "x");
    await ks.delete("openai");
    const ks2 = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    expect(await ks2.get("openai")).toBeNull();
  });

  it("并发 set 串行落盘：重载后各键均为最终值（写竞态回归）", async () => {
    const io = new MemoryIO();
    const ks = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    await Promise.all([ks.set("a", "1"), ks.set("b", "2"), ks.set("c", "3")]);
    const ks2 = new KeyStorage(io, PATH, fakeSafeStorage("machine-a"));
    expect(await ks2.get("a")).toBe("1");
    expect(await ks2.get("b")).toBe("2");
    expect(await ks2.get("c")).toBe("3");
  });
});
