/**
 * 数据库 Seed：初始化系统角色（ADMIN / DEVELOPER / VIEWER）。
 * 管理员账号不在此处硬编码，通过 `npm run create-admin` 交互创建。
 */
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS } from '../src/common/permissions';

const prisma = new PrismaClient();

const SYSTEM_ROLES = [
  {
    code: 'ADMIN',
    name: '系统管理员',
    description: '全部权限：用户/角色/项目/数据表/字段/数据/API 密钥/审计',
    permissions: ['*'],
  },
  {
    code: 'DEVELOPER',
    name: '开发者',
    description: '项目/数据表/字段/数据 CRUD、公式、API 密钥、导出；不含用户与角色管理',
    permissions: ALL_PERMISSIONS.filter(
      (p) => !p.startsWith('user:') && !p.startsWith('role:') && p !== 'audit:read',
    ),
  },
  {
    code: 'VIEWER',
    name: '只读用户',
    description: '查看项目/数据表/记录，查询、筛选、排序、分页与 Excel 导出',
    permissions: ['project:read', 'table:read', 'field:read', 'record:read', 'export'],
  },
];

async function main(): Promise<void> {
  console.log('[seed] 开始初始化系统角色...');
  for (const role of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({ where: { code: role.code } });
    if (existing) {
      await prisma.role.update({
        where: { code: role.code },
        data: {
          name: role.name,
          description: role.description,
          permissions: role.permissions as unknown as object,
          isSystem: true,
        },
      });
      console.log(`[seed] 角色 ${role.code} 已更新`);
    } else {
      await prisma.role.create({
        data: {
          code: role.code,
          name: role.name,
          description: role.description,
          permissions: role.permissions as unknown as object,
          isSystem: true,
        },
      });
      console.log(`[seed] 角色 ${role.code} 已创建`);
    }
  }
  console.log('[seed] 完成。管理员账号请执行: npm run create-admin');
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
