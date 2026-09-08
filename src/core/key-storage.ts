import type { TextFileIO } from "../types";

/** Electron safeStorage 的最小结构抽象，便于单元测试注入 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface SecretsFile {
  encrypted: boolean;
  items: Record<string, string>;
}

/**
 * API Key 安全存储（设计文档 4.4.1）
 * - 优先 safeStorage（操作系统钥匙串）加密，Base64 落盘 secrets.bin；不写入 data.json
 * - 极少数无钥匙串环境降级 Base64 混淆存储（非安全，设置面板需明确提示风险）
 * - 解密失败（典型场景：secrets.bin 被同步到其他设备）丢弃该条目并计数；
 *   设置面板据 hasDecryptFailures() 引导重新输入，不拿错误 Key 发请求
 */
export class KeyStorage {
  private memory = new Map<string, string>();
  private loaded = false;
  private decryptFailures = 0;

  constructor(
    private io: TextFileIO,
    private filePath: string,
    private safeStorage?: SafeStorageLike
  ) {}

  isEncryptionAvailable(): boolean {
    return !!this.safeStorage && this.safeStorage.isEncryptionAvailable();
  }

  hasDecryptFailures(): boolean {
    return this.decryptFailures > 0;
  }

  async get(keyId: string): Promise<string | null> {
    await this.ensureLoaded();
    return this.memory.get(keyId) ?? null;
  }

  async set(keyId: string, value: string): Promise<void> {
    await this.ensureLoaded();
    this.memory.set(keyId, value);
    await this.persist();
  }

  async delete(keyId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.memory.delete(keyId)) {
      await this.persist();
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!(await this.io.exists(this.filePath))) return;
    let raw: SecretsFile;
    try {
      raw = JSON.parse(await this.io.read(this.filePath)) as SecretsFile;
    } catch {
      return; // 文件损坏：视为无密钥
    }
    const wasEncrypted = raw.encrypted === true;
    for (const [keyId, stored] of Object.entries(raw.items ?? {})) {
      try {
        this.memory.set(keyId, this.decode(stored, wasEncrypted));
      } catch {
        this.decryptFailures++;
      }
    }
  }

  private decode(stored: string, wasEncrypted: boolean): string {
    if (wasEncrypted) {
      if (!this.isEncryptionAvailable()) {
        throw new Error("safeStorage unavailable on this machine");
      }
      return this.safeStorage!.decryptString(Buffer.from(stored, "base64"));
    }
    // 降级分支：Base64 混淆（明示非加密）
    return Buffer.from(stored, "base64").toString("utf8");
  }

  private writeQueue: Promise<void> = Promise.resolve();

  /** 写盘串行化：击键触发的连续 persist 排队执行，避免并发写竞态（旧值后落盘覆盖新值） */
  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.catch(() => undefined).then(() => this.writeNow());
    return this.writeQueue;
  }

  private async writeNow(): Promise<void> {
    const useEncryption = this.isEncryptionAvailable();
    const items: Record<string, string> = {};
    for (const [keyId, value] of this.memory) {
      items[keyId] = useEncryption
        ? this.safeStorage!.encryptString(value).toString("base64")
        : Buffer.from(value, "utf8").toString("base64");
    }
    const file: SecretsFile = { encrypted: useEncryption, items };
    await this.io.write(this.filePath, JSON.stringify(file, null, 2));
  }
}
