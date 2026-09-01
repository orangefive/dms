import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-auth.decorator';
import { buildPagination } from '../common/dto/pagination.dto';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  displayName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsArray()
  @IsString({ each: true })
  roleCodes!: string[];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];
}

class ListUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize: number = 300;
}

@ApiTags('用户管理')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('user:manage')
  @ApiOperation({ summary: '用户列表' })
  async list(@Query() q: ListUsersDto) {
    const { users, total } = await this.usersService.list(q.page, q.pageSize);
    return { users, pagination: buildPagination(q.page, q.pageSize, total) };
  }

  @Post()
  @Permissions('user:manage')
  @ApiOperation({ summary: '创建用户' })
  async create(@Body() dto: CreateUserDto, @CurrentUser() operator: { id: string }) {
    return this.usersService.create({
      username: dto.username,
      email: dto.email,
      displayName: dto.displayName,
      password: dto.password,
      roleCodes: dto.roleCodes,
      operatorId: operator.id,
    });
  }

  @Patch(':id')
  @Permissions('user:manage')
  @ApiOperation({ summary: '更新用户（角色/状态/密码重置）' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() operator: { id: string },
  ) {
    return this.usersService.update(id, {
      displayName: dto.displayName,
      email: dto.email,
      isActive: dto.isActive,
      password: dto.password,
      roleCodes: dto.roleCodes,
      operatorId: operator.id,
    });
  }

  @Delete(':id')
  @Permissions('user:manage')
  @ApiOperation({ summary: '删除用户' })
  async remove(@Param('id') id: string, @CurrentUser() operator: { id: string }) {
    await this.usersService.remove(id, operator.id);
    return { deleted: true };
  }
}
