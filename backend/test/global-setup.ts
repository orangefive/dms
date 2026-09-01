/**
 * e2e 全局准备：对 dms_test 数据库执行迁移与 Seed。
 * 通过 prisma migrate deploy 应用全部迁移（含 utf8mb4_bin 唯一值列）。
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';

const root = path.resolve(__dirname, '..');

export default async function globalSetup(): Promise<void> {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? 'mysql://root@127.0.0.1:3307/dms_test';
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    npm_config_cache: process.env.npm_config_cache ?? path.resolve(root, '..', '.npm-cache'),
  };

  console.log('[global-setup] 开始准备测试数据库...');
  // prisma migrate reset 会重建数据库并应用全部迁移（含 utf8mb4_bin 唯一值列）
  execSync(`npx prisma migrate reset --force --skip-seed`, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  // Seed 系统角色（ADMIN/DEVELOPER/VIEWER）
  execSync(`npx prisma db seed`, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  console.log(`[global-setup] 迁移与 Seed 完成，数据库: ${databaseUrl}`);
}
