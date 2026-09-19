import type { Request, Response } from 'express';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.cookieValue(request, REFRESH_TOKEN_COOKIE);
    if (refreshToken) await this.authService.logout(refreshToken);
    response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
  }

  @Get('me')
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
