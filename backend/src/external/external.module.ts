import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExternalMetadataService } from './external-metadata.service';
import { ExternalController } from './external.controller';

@Module({
  imports: [PrismaModule],
  providers: [ExternalMetadataService],
  controllers: [ExternalController],
  exports: [ExternalMetadataService],
})
export class ExternalModule {}
