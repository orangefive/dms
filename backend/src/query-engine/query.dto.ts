import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { QUERY_OPERATORS, QueryOperator } from './query.types';

export class QueryFilterDto {
  @ApiProperty({ description: '字段标识 field_key（必须来自字段元数据白名单）', example: 'sku' })
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: '字段名只能包含字母、数字、下划线，且不能以数字开头' })
  field!: string;

  @ApiProperty({ description: '操作符（白名单）', enum: QUERY_OPERATORS, example: 'eq' })
  @IsIn(QUERY_OPERATORS, { message: '不支持的操作符' })
  operator!: QueryOperator;

  @ApiPropertyOptional({ description: '操作值（is_null / is_not_null 不需要）' })
  @IsOptional()
  value?: unknown;
}

export class QuerySortDto {
  @ApiProperty({ description: '排序字段 field_key' })
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: '排序字段名非法' })
  field!: string;

  @ApiProperty({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  order!: 'asc' | 'desc';
}

export class QueryDto {
  @ApiPropertyOptional({ description: '过滤条件（AND 语义）', type: [QueryFilterDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  filters?: QueryFilterDto[];

  @ApiPropertyOptional({ description: '条件逻辑，第一版仅支持 AND', enum: ['AND'], default: 'AND' })
  @IsOptional()
  @IsIn(['AND'] as const)
  logic: 'AND' = 'AND' as const;

  @ApiPropertyOptional({ description: '排序', type: [QuerySortDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuerySortDto)
  sort?: QuerySortDto[];

  @ApiPropertyOptional({ description: '页码（上限 100000）', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page: number = 1;

  @ApiPropertyOptional({ description: '每页数量，默认 300，最大 500', default: 300, enum: [100, 200, 300, 500] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize: number = 300;
}

/** find-one / find 精确查询 */
export class FindOneDto {
  @ApiProperty({ description: '字段标识 field_key（精确匹配，EXACT）', example: 'sku' })
  @IsString()
  @MaxLength(128)
  field!: string;

  @ApiProperty({ description: '精确匹配值', example: 'ABC123' })
  @IsOptional()
  value?: unknown;
}

export class FindQueryDto {
  @ApiProperty({ description: '字段标识 field_key（精确匹配，EXACT）', example: 'sku' })
  @IsString()
  @MaxLength(128)
  field!: string;

  @ApiProperty({ description: '精确匹配值', example: 'ABC123' })
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({ description: '每页数量', default: 50, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize: number = 50;
}
