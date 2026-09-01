import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExternalModule } from '../external/external.module';
import { QueryService } from './query.service';

@Module({
  imports: [PrismaModule, ExternalModule],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
