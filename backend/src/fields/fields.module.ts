import { Module } from '@nestjs/common';
import { FieldsService } from './fields.service';
import { FieldsController } from './fields.controller';
import { FormulaModule } from '../formula/formula.module';
import { AuditModule } from '../audit/audit.module';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [FormulaModule, AuditModule, TablesModule],
  providers: [FieldsService],
  controllers: [FieldsController],
  exports: [FieldsService],
})
export class FieldsModule {}
