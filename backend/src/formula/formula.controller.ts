import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { FormulaService } from './formula.service';
import { AppError } from '../common/errors/app-error';
export class ValidateFormulaDto {
  @IsString()
  @Length(1, 4000)
  expression!: string;

  @IsOptional()
  @IsString()
  fieldId?: string;
}

class RecalculateDto {
  @IsOptional()
  @IsString()
  fieldId?: string;
}

@ApiTags('公式')
@ApiBearerAuth()
@Controller('tables/:tableId/formula')
export class FormulaController {
  constructor(private readonly formulaService: FormulaService) {}

  /** 公式实时校验（前端编辑器保存前调用） */
  @Post('validate')
  @Permissions('field:read')
  @ApiOperation({ summary: '校验公式表达式（语法/字段/类型/函数/循环引用）' })
  async validate(
    @Param('tableId') tableId: string,
    @Body() dto: ValidateFormulaDto,
  ): Promise<{
    valid: boolean;
    normalized?: string;
    resultType?: string;
    dependencies?: string[];
    error?: { code: string; message: string };
  }> {
    try {
      const result = await this.formulaService.validateExpression(
        tableId,
        dto.expression,
        dto.fieldId,
      );
      return {
        valid: true,
        normalized: result.normalized,
        resultType: result.resultType,
        dependencies: result.dependencies,
      };
    } catch (err) {
      if (err instanceof AppError) {
        return { valid: false, error: { code: err.code, message: err.message } };
      }
      throw err;
    }
  }

  /** 重算历史记录（公式定义修改后 / 手动触发），500 条一批 */
  @Post('recalculate')
  @Permissions('field:write')
  @ApiOperation({ summary: '重算公式字段的历史数据（分批执行）' })
  async recalculate(@Param('tableId') tableId: string, @Body() dto: RecalculateDto) {
    const result = await this.formulaService.recalculateTable(tableId, dto.fieldId);
    return result;
  }
}
