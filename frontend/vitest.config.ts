import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    // 每个用例独立还原 mock，避免用例间串味
    restoreMocks: true,
    clearMocks: true,
    // 用例数量少，串行执行换取确定性输出：避免多文件并发共享 jsdom 全局
    //（window.location / Blob 桩）以及模块级单例状态互相干扰
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
  },
});
