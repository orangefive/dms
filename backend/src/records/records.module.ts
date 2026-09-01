import { Module } from '@nestjs/common';
import { RecordsService } from './records.service';
import { RecordsController } from './records.controller';
import { QueryModule } from '../query-engine/query.module';
import { FormulaModule } from '../formula/formula.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [QueryModule, FormulaModule, AuditModule],
  providers: [RecordsService],
  controllers: [RecordsController],
  exports: [RecordsService],
})
export class RecordsModule {}
