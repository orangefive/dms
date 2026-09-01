import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv, appConfigLoader } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { ProjectsModule } from './projects/projects.module';
import { TablesModule } from './tables/tables.module';
import { FieldsModule } from './fields/fields.module';
import { RecordsModule } from './records/records.module';
import { FormulaModule } from './formula/formula.module';
import { QueryModule } from './query-engine/query.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuditModule } from './audit/audit.module';
import { ExternalModule } from './external/external.module';
import { ExportModule } from './export/export.module';
import { ImportModule } from './import/import.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [appConfigLoader],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () =>
        process.env.NODE_ENV === 'test'
          ? [{ ttl: 60_000, limit: 100_000 }]
          : [{ ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT) || 300 }],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    ProjectsModule,
    TablesModule,
    FieldsModule,
    RecordsModule,
    FormulaModule,
    QueryModule,
    ApiKeysModule,
    AuditModule,
    ExternalModule,
    ExportModule,
    ImportModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
