import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: '健康检查' })
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
