import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FormulaService } from './formula.service';
import { FormulaController } from './formula.controller';

@Module({
  imports: [PrismaModule],
  providers: [FormulaService],
  controllers: [FormulaController],
  exports: [FormulaService],
})
export class FormulaModule {}
