/**
 * 交互式创建管理员账号。
 * 用法：npm run create-admin
 * 管理员账号不硬编码，首次部署必须执行本脚本。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as readline from 'node:readline';
import * as process from 'node:process';
import 'dotenv/config';

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
const lines = rl[Symbol.asyncIterator]();

/** 逐行提问：交互终端与管道输入（测试/CI）都可用 */
async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  const next = await lines.next();
  if (next.done || next.value === undefined) {
    throw new Error('输入已结束（请在交互终端中运行本命令）');
  }
  return next.value;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return '密码长度不能少于 8 位';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '密码必须同时包含字母和数字';
  }
  return null;
}

async function main(): Promise<void> {
  console.log('=== 创建管理员账号 ===');
  console.log('（管理员账号不会在任何代码或配置中硬编码）\n');

  const adminCount = await prisma.user.count({
    where: { roles: { some: { role: { code: 'ADMIN' } } } },
  });
  if (adminCount > 0) {
    console.log(`提示：系统中已存在 ${adminCount} 个管理员账号，可继续创建新管理员。\n`);
  }

  const username = (await ask('用户名: ')).trim();
  if (!/^[A-Za-z0-9_.-]{2,64}$/.test(username)) {
    throw new Error('用户名只能包含字母、数字、_ . -，长度 2-64');
  }
  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) {
    throw new Error(`用户名 ${username} 已被占用`);
  }

  const email = (await ask('邮箱: ')).trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error('邮箱格式不正确');
  }
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    throw new Error(`邮箱 ${email} 已被占用`);
  }

  let password = '';
  for (;;) {
    password = await ask('密码（至少 8 位，含字母和数字）: ');
    const err = validatePassword(password);
    if (err) {
      console.log(`  密码不通过：${err}`);
      continue;
    }
    const confirm = await ask('再次输入密码确认: ');
    if (confirm !== password) {
      console.log('  两次输入的密码不一致，请重新输入');
      continue;
    }
    break;
  }

  const adminRole = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
  if (!adminRole) {
    throw new Error('ADMIN 角色不存在，请先执行 npm run db:seed');
  }

  const displayName = (await ask('显示名称（回车使用用户名）: ')).trim() || username;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username,
      email,
      displayName,
      passwordHash,
      roles: { create: [{ roleId: adminRole.id }] },
    },
    select: { id: true, username: true, email: true, displayName: true },
  });

  console.log('\n=== 管理员创建成功 ===');
  console.log(`  用户名: ${user.username}`);
  console.log(`  邮箱:   ${user.email}`);
  console.log(`  角色:   ADMIN`);
}

main()
  .catch((e: unknown) => {
    console.error(`\n创建失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => {
    rl.close();
    void prisma.$disconnect();
  });
