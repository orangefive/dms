import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 健康检查：不只判断进程存活，同时验证数据库连接。
   * 返回 503 时 Docker healthcheck / 负载均衡会摘除实例。
   */
  @Public()
  @SkipTransform()
  @Get()
  @ApiOperation({ summary: '健康检查（含数据库连通性）' })
  async health(): Promise<{ status: string; database: string; time: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
        time: new Date().toISOString(),
      });
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString() };
  }
}
