import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JWT_CONFIG } from '../src/auth/auth.types';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockResponse = (): Response => {
    const res: Record<string, jest.Mock> = {};
    res.cookie = jest.fn().mockReturnValue(res);
    res.clearCookie = jest.fn().mockReturnValue(res);
    return res as unknown as Response;
  };

  beforeEach(async () => {
    const mockAuthService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getCurrentUser: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue('production'),
    };

    const mockJwtConfig = {
      secret: 'supersecretstringmustbe32charslong!!',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604800,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JWT_CONFIG, useValue: mockJwtConfig },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  it('login tra ve ket qua va dat refresh cookie', async () => {
    const authResult = {
      accessToken: 'access.jwt',
      refreshToken: 'refresh.jwt',
      expiresIn: 900,
      tokenType: 'Bearer',
      user: {
        id: 'u-1',
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'ADMIN' as const,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      },
    };
    authService.login.mockResolvedValueOnce(authResult);

    const res = mockResponse();
    const req = {
      get: jest.fn().mockReturnValue('Jest'),
      ip: '127.0.0.1',
    } as unknown as import('express').Request;

    const result = await controller.login(
      { email: 'test@example.com', password: 'password123' },
      req,
      res,
    );

    expect(result).toBe(authResult);
    expect(res.cookie).toHaveBeenCalled();
  });

  it('refresh goi authService.refresh va dat cookie moi', async () => {
    const authResult = {
      accessToken: 'access.jwt.2',
      refreshToken: 'refresh.jwt.2',
      expiresIn: 900,
      tokenType: 'Bearer',
      user: {
        id: 'u-1',
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'ADMIN' as const,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      },
    };
    authService.refresh.mockResolvedValueOnce(authResult);

    const res = mockResponse();
    const req = {
      cookies: { camerai_refresh: 'old-refresh' },
    } as unknown as import('express').Request;

    const result = await controller.refresh({}, req, res);
    expect(result).toBe(authResult);
    expect(res.cookie).toHaveBeenCalled();
  });

  it('logout xoa cookie refresh', async () => {
    const res = mockResponse();
    const req = {
      cookies: { camerai_refresh: 'token-to-revoke' },
    } as unknown as import('express').Request;

    await controller.logout(req, res);
    expect(authService.logout).toHaveBeenCalledWith('token-to-revoke');
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('getCurrentUser tra ve thong tin user hien tai', async () => {
    const mockUser = {
      id: 'u-1',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'ADMIN' as const,
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    };
    authService.getCurrentUser.mockResolvedValueOnce(mockUser);

    const req = {
      auth: { email: 'test@example.com' },
    } as unknown as import('../src/auth/jwt-auth.guard').AuthenticatedRequest;

    const result = await controller.getCurrentUser(req);
    expect(result).toBe(mockUser);
    expect(authService.getCurrentUser).toHaveBeenCalledWith('test@example.com');
  });
});
