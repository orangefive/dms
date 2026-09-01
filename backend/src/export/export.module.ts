import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { QueryModule } from '../query-engine/query.module';

@Module({
  imports: [QueryModule],
  providers: [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
