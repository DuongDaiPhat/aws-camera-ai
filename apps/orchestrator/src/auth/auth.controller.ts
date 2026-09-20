import type { Request, Response } from 'express';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { Public } from './public.decorator';
import {
  JWT_CONFIG,
  type AuthResult,
  type ClientContext,
  type JwtConfig,
  type PublicUser,
} from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

const REFRESH_TOKEN_COOKIE = 'camerai_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    @Inject(JWT_CONFIG) private readonly jwtConfig: JwtConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đăng nhập người dùng (US-05)',
    description:
      'Xác thực bằng email và mật khẩu, trả về accessToken và thiết lập cookie refreshToken.',
  })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công' })
  @ApiResponse({ status: 401, description: 'Email hoặc mật khẩu không đúng' })
  @ApiResponse({
    status: 423,
    description: 'Tài khoản đang bị khóa tạm thời do nhập sai quá nhiều lần',
  })
  async login(
    @Body() credentials: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const result = await this.authService.login(credentials, this.clientContext(request));
    this.setRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Làm mới token (US-05)',
    description: 'Cấp cặp token mới bằng refreshToken từ body hoặc cookie.',
  })
  @ApiResponse({ status: 200, description: 'Làm mới token thành công' })
  @ApiResponse({ status: 401, description: 'Refresh token không hợp lệ hoặc đã hết hạn' })
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const result = await this.authService.refresh(this.readRefreshToken(body, request));
    this.setRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Đăng xuất người dùng (US-05)',
    description: 'Thu hồi refresh token và xóa cookie xác thực.',
  })
  @ApiResponse({ status: 204, description: 'Đăng xuất thành công' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.cookieValue(request, REFRESH_TOKEN_COOKIE);
    if (refreshToken) await this.authService.logout(refreshToken);
    response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Lấy thông tin tài khoản hiện tại (US-05)',
    description: 'Trả về thông tin hồ sơ của người dùng đang đăng nhập.',
  })
  @ApiResponse({ status: 200, description: 'Thông tin người dùng' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực hoặc token không hợp lệ' })
  getCurrentUser(@Req() request: AuthenticatedRequest): Promise<PublicUser> {
    return this.authService.getCurrentUser(request.auth?.email ?? '');
  }

  private readRefreshToken(body: RefreshTokenDto, request: Request): string {
    return body.refreshToken ?? this.cookieValue(request, REFRESH_TOKEN_COOKIE) ?? '';
  }

  private cookieValue(request: Request, name: string): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[name];
    return typeof value === 'string' ? value : undefined;
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.jwtConfig.refreshTtlSeconds * 1000,
    });
  }

  private clientContext(request: Request): ClientContext {
    return {
      ipAddress: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
