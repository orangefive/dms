import { Module } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportController } from './import.controller';
import { QueryModule } from '../query-engine/query.module';
import { RecordsModule } from '../records/records.module';

@Module({
  imports: [QueryModule, RecordsModule],
  providers: [ImportService],
  controllers: [ImportController],
})
export class ImportModule {}
