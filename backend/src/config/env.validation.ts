/**
 * 环境变量加载与校验。
 * 生产环境缺少关键密钥或密钥强度不足时直接失败（fail fast），
 * 开发环境使用明确标记的开发默认值，避免“看起来能用、实际不安全”。
 */
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * 布尔环境变量解析。
 * 之前使用 @Type(() => Boolean) 会把字符串 "false" 解析为 true，
 * 导致 COOKIE_SECURE / SWAGGER_ENABLED 在配置为 false 时反而开启。
 */
function parseBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return value; // 交给 @IsBoolean 报错，而不是静默当成 false
}

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @IsOptional()
  JWT_SECRET?: string;

  @IsString()
  JWT_EXPIRES_IN: string = '30m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_SECRET?: string;

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsString()
  @IsOptional()
  API_KEY_SECRET?: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  BATCH_INSERT_LIMIT: number = 1000;

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:5173';

  @IsBoolean()
  @Transform(({ value }) => parseBoolean(value))
  COOKIE_SECURE: boolean = false;

  @IsBoolean()
  @Transform(({ value }) => parseBoolean(value))
  SWAGGER_ENABLED: boolean = false;

  /** 是否信任反向代理的 X-Forwarded-* 头（Docker/Nginx 部署应为 true） */
  @IsBoolean()
  @Transform(({ value }) => parseBoolean(value))
  TRUST_PROXY: boolean = false;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret: string;
  jwtRefreshExpiresIn: string;
  apiKeySecret: string;
  batchInsertLimit: number;
  corsOrigins: string[];
  cookieSecure: boolean;
  swaggerEnabled: boolean;
  trustProxy: boolean;
  isProduction: boolean;
}

/** 生产环境要求的关键密钥，缺失即抛错 */
const REQUIRED_IN_PRODUCTION: Array<keyof EnvironmentVariables> = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'API_KEY_SECRET',
];

const SECRET_MIN_LENGTH = 32;
const PLACEHOLDER_PREFIXES = ['please_change_me', 'dev_', 'change_me'];

function assertStrongSecret(name: string, value: unknown): void {
  if (typeof value !== 'string' || value.length < SECRET_MIN_LENGTH) {
    throw new Error(
      `生产环境 ${name} 长度必须不少于 ${SECRET_MIN_LENGTH} 个字符（当前 ${String(value ?? '').length}）`,
    );
  }
  if (PLACEHOLDER_PREFIXES.some((p) => value.toLowerCase().startsWith(p))) {
    throw new Error(`生产环境 ${name} 仍是示例占位值，请更换为随机密钥`);
  }
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new Error(`环境变量校验失败:\n${messages}`);
  }

  if (!/^mysql:\/\//.test(validated.DATABASE_URL)) {
    throw new Error('DATABASE_URL 必须是 mysql:// 连接串');
  }

  if (validated.NODE_ENV === 'production') {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!config[key]) {
        throw new Error(`生产环境必须配置环境变量 ${key}`);
      }
    }
    assertStrongSecret('JWT_SECRET', validated.JWT_SECRET);
    assertStrongSecret('JWT_REFRESH_SECRET', validated.JWT_REFRESH_SECRET);
    assertStrongSecret('API_KEY_SECRET', validated.API_KEY_SECRET);
    if (validated.JWT_SECRET === validated.JWT_REFRESH_SECRET) {
      throw new Error('生产环境 JWT_SECRET 与 JWT_REFRESH_SECRET 必须使用不同密钥');
    }
    if (validated.API_KEY_SECRET === validated.JWT_SECRET || validated.API_KEY_SECRET === validated.JWT_REFRESH_SECRET) {
      throw new Error('生产环境 API_KEY_SECRET 必须与 JWT 密钥不同');
    }
    if (validated.CORS_ORIGIN.split(',').map((s) => s.trim()).includes('*')) {
      throw new Error('生产环境 CORS_ORIGIN 不允许使用通配符 "*"');
    }
  }

  return validated;
}

/** 生成统一的应用配置对象 */
export function buildAppConfig(env: EnvironmentVariables): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET ?? 'dev_jwt_secret_do_not_use_in_prod_0001',
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_do_not_use_in_prod_0001',
    jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    apiKeySecret: env.API_KEY_SECRET ?? 'dev_api_key_secret_do_not_use_in_prod_0001',
    batchInsertLimit: env.BATCH_INSERT_LIMIT,
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: env.COOKIE_SECURE,
    // 默认关闭；只有显式配置 SWAGGER_ENABLED=true 才暴露接口文档
    swaggerEnabled: env.SWAGGER_ENABLED,
    trustProxy: env.TRUST_PROXY,
    isProduction: env.NODE_ENV === 'production',
  };
}

/** ConfigModule load 工厂：把解析后的配置挂到 config.get('app') */
export function appConfigLoader(): { app: AppConfig } {
  const env = validateEnv(process.env as Record<string, unknown>);
  return { app: buildAppConfig(env) };
}

/** 解析 '7d' / '30m' / '1h' / '3600' 为毫秒（供 Cookie 与刷新令牌共用） */
export function parseDuration(value: string): number {
  const m = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!m) {
    return 7 * 24 * 3600 * 1000;
  }
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 3600 * 1000;
    case 'd':
      return n * 24 * 3600 * 1000;
    default:
      return n * 1000;
  }
}
