import { Module } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportController } from './import.controller';
import { QueryModule } from '../query-engine/query.module';
import { RecordsModule } from '../records/records.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [QueryModule, RecordsModule, AuditModule],
  providers: [ImportService],
  controllers: [ImportController],
})
export class ImportModule {}
