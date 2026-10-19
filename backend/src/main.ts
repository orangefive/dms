import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const appConfig = config.get<AppConfig>('app');
  if (!appConfig) {
    throw new Error('应用配置加载失败');
  }

  const logger = new Logger('Bootstrap');
  app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);

  // 反向代理下正确获取客户端 IP（审计日志与限流依赖）
  if (appConfig.trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  app.enableShutdownHooks();

  // 安全中间件
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // CORS（白名单来自 CORS_ORIGIN，逗号分隔）
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // 全局前缀
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Swagger / OpenAPI
  if (appConfig.swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('企业多维数据管理系统 API')
      .setDescription(
        `统一响应格式：
- 成功: { "success": true, "data": ... }
- 失败: { "success": false, "error": { "code": "...", "message": "..." } }

认证方式：
1. 网页用户: Authorization: Bearer <JWT>（登录后获取）
2. n8n/自动化: Authorization: Bearer dms_xxxxxxxx（API 密钥，创建时仅显示一次）

Query DSL 示例：
POST /api/v1/tables/:tableId/records/query
{ "filters": [ { "field": "sku", "operator": "eq", "value": "ABC123" } ], "logic": "AND", "sort": [ { "field": "sales", "order": "desc" } ], "page": 1, "pageSize": 100 }

Batch 写入：
POST /api/v1/tables/:tableId/records/batch
{ "records": [ { "sku": "ABC001", "sales": 100 }, { "sku": "ABC002", "sales": 200 } ] }

Upsert（match 精确匹配）：
POST /api/v1/tables/:tableId/records/upsert
{ "match": { "shop": "Amazon-US", "sku": "ABC123" }, "data": { "sales": 299 } }`,
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'dms_xxx' },
        'APIKey',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = appConfig.port;
  await app.listen(port);
  logger.log(`后端服务已启动: http://localhost:${port}/api/v1`);
  if (appConfig.swaggerEnabled) {
    logger.log(`Swagger 文档: http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
