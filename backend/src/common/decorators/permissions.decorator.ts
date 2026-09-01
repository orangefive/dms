import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 声明路由所需权限编码。
 * 用法：@Permissions('record:write') 或 @Permissions('record:write', 'record:delete')
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
