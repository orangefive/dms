/** 请求认证上下文：网页用户 JWT 或 API Key */
export type AuthContext =
  | {
      type: 'user';
      id: string;
      username: string;
      roleCodes: string[];
    }
  | {
      type: 'apiKey';
      keyId: string;
      name: string;
      scopes: string[];
    };
