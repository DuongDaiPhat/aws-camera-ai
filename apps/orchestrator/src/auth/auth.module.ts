import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Argon2PasswordHasher } from './argon2-password-hasher';
import { AuthController } from './auth.controller';
import { PostgresAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  AUTH_REPOSITORY,
  JWT_CONFIG,
  PASSWORD_HASHER,
  TOKEN_SERVICE,
  type AuthPolicy,
  type JwtConfig,
} from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtTokenService } from './jwt-token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PostgresAuthRepository,
    Argon2PasswordHasher,
    JwtTokenService,
    { provide: AUTH_REPOSITORY, useExisting: PostgresAuthRepository },
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: TOKEN_SERVICE, useExisting: JwtTokenService },
    { provide: AUTH_CLOCK, useValue: (): Date => new Date() },
    {
      provide: AUTH_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AuthPolicy => ({
        maxLoginAttempts: positiveInteger(config, 'LOGIN_MAX_ATTEMPTS'),
        lockDurationMinutes: positiveInteger(config, 'LOGIN_LOCK_MINUTES'),
      }),
    },
    {
      provide: JWT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtConfig => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        accessTtlSeconds: positiveInteger(config, 'JWT_ACCESS_TTL'),
        refreshTtlSeconds: positiveInteger(config, 'JWT_REFRESH_TTL'),
      }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

function positiveInteger(config: ConfigService, key: string): number {
  const value = Number(config.getOrThrow<string>(key));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương.`);
  }
  return value;
}
