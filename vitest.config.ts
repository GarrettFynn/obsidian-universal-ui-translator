import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // obsidian 为运行时外部模块：集成测试用 mock 替身（8.1）
      obsidian: fileURLToPath(new URL("./tests/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
