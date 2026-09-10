// Electron 运行时模块（Obsidian 桌面端内置，esbuild external）；
// 最小类型声明仅覆盖 safeStorage 用法，与 src/core/key-storage.ts 的 SafeStorageLike 对齐
declare module "electron" {
  export const safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(encrypted: Buffer): string;
  };
}
