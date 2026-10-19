/** 请求认证上下文：网页用户 JWT 或 API Key */
export type AuthContext =
  | {
      type: 'user';
      id: string;
      username: string;
      roleCodes: string[];
      /**
       * 每次请求从数据库加载的实时权限集合。
       * 不信任 JWT 中的 roles 声明，确保禁用账号/角色变更立即生效。
       */
      permissions: string[];
    }
  | {
      type: 'apiKey';
      keyId: string;
      name: string;
      scopes: string[];
    };
