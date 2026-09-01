/**
 * 环境变量加载与校验。
 * 生产环境缺少关键密钥时直接失败（fail fast），开发环境提供安全默认值。
 */
import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

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
  @Type(() => Boolean)
  COOKIE_SECURE: boolean = false;

  @IsBoolean()
  @Type(() => Boolean)
  SWAGGER_ENABLED: boolean = true;

  @IsOptional()
  @IsUrl({ require_tld: false })
  EXTERNAL_DATABASE_URL?: string;
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
  externalDatabaseUrl?: string;
  isProduction: boolean;
}

/** 生产环境要求的关键密钥，缺失即抛错 */
const REQUIRED_IN_PRODUCTION: Array<keyof EnvironmentVariables> = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'API_KEY_SECRET',
];

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join('; '))
      .join('\n');
    throw new Error(`环境变量校验失败:\n${messages}`);
  }
  if (validated.NODE_ENV === 'production') {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!config[key]) {
        throw new Error(`生产环境必须配置环境变量 ${key}`);
      }
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
    jwtSecret: env.JWT_SECRET ?? 'dev_jwt_secret_do_not_use_in_prod',
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_do_not_use_in_prod',
    jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    apiKeySecret: env.API_KEY_SECRET ?? 'dev_api_key_secret_do_not_use_in_prod',
    batchInsertLimit: env.BATCH_INSERT_LIMIT,
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: env.COOKIE_SECURE,
    swaggerEnabled: env.SWAGGER_ENABLED,
    externalDatabaseUrl: env.EXTERNAL_DATABASE_URL,
    isProduction: env.NODE_ENV === 'production',
  };
}

/** ConfigModule load 工厂：把解析后的配置挂到 config.get('app') */
export function appConfigLoader(): { app: AppConfig } {
  const env = validateEnv(process.env as Record<string, unknown>);
  return { app: buildAppConfig(env) };
}
