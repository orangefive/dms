import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-auth.decorator';
import { AuthService, AuthUserInfo } from './auth.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { AppConfig, parseDuration } from '../config/env.validation';

class LoginDto {
  @IsString()
  @MaxLength(128)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

class ChangePasswordDto {
  @IsString()
  oldPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码必须同时包含字母和数字' })
  newPassword!: string;
}

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: '登录（用户名或邮箱 + 密码）' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.username, dto.password);
    this.setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: '刷新 Access Token（Refresh Token 轮换）' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = dto.refreshToken ?? (req.cookies?.[AuthService.REFRESH_COOKIE] as string | undefined);
    if (!token) {
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, '缺少 Refresh Token');
    }
    const result = await this.authService.refresh(token);
    this.setRefreshCookie(res, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: '退出登录（注销 Refresh Token）' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[AuthService.REFRESH_COOKIE] as string | undefined;
    await this.authService.logout(token);
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录用户信息（含角色与权限）' })
  async me(@CurrentUser() user: { id: string }): Promise<AuthUserInfo> {
    return this.authService.me(user.id);
  }

  @Post('change-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改自己的密码（成功后其他会话失效）' })
  async changePassword(@CurrentUser() user: { id: string }, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.id, dto.oldPassword, dto.newPassword);
    return { changed: true };
  }

  private get cfg(): AppConfig {
    const cfg = this.configService.get<AppConfig>('app');
    if (!cfg) {
      throw new Error('应用配置缺失');
    }
    return cfg;
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(AuthService.REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cfg.cookieSecure,
      path: '/api/v1/auth',
      maxAge: parseDuration(this.cfg.jwtRefreshExpiresIn),
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(AuthService.REFRESH_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cfg.cookieSecure,
      path: '/api/v1/auth',
    });
  }
}
