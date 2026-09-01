import { Module } from '@nestjs/common';
import { TablesService } from './tables.service';
import { TablesController } from './tables.controller';
import { AuditModule } from '../audit/audit.module';
import { ExternalModule } from '../external/external.module';

@Module({
  imports: [AuditModule, ExternalModule],
  providers: [TablesService],
  controllers: [TablesController],
  exports: [TablesService],
})
export class TablesModule {}
