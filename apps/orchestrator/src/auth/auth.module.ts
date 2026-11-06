import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Argon2PasswordHasher } from './argon2-password-hasher';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
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
  type TokenService,
} from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtTokenService } from './jwt-token.service';
import { RolesGuard } from './roles.guard';
import { ResourceAccessGuard } from './resource-access.guard';
import { AUTH_SETTINGS, readAuthSettings, type AuthSettings } from './auth.config';
import { CognitoTokenService } from './cognito-token.service';
import { CognitoVerifierService } from './cognito-verifier.service';
import { DatabaseService } from '../database/database.service';

@Module({
  controllers: [AuthController, UsersController],
  providers: [
    UsersRepository,
    UsersService,
    AuthService,
    PostgresAuthRepository,
    Argon2PasswordHasher,
    { provide: AUTH_SETTINGS, inject: [ConfigService], useFactory: readAuthSettings },
    { provide: AUTH_REPOSITORY, useExisting: PostgresAuthRepository },
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    {
      provide: TOKEN_SERVICE,
      inject: [AUTH_SETTINGS, JWT_CONFIG, ConfigService, DatabaseService],
      useFactory: (
        settings: AuthSettings,
        jwt: JwtConfig | null,
        config: ConfigService,
        database: DatabaseService,
      ): TokenService => {
        if (settings.provider === 'cognito') {
          return new CognitoTokenService(new CognitoVerifierService(config), database);
        }
        if (!jwt) throw new Error('Thiếu cấu hình JWT local.');
        return new JwtTokenService(jwt);
      },
    },
    { provide: AUTH_CLOCK, useValue: (): Date => new Date() },
    {
      provide: AUTH_POLICY,
      inject: [ConfigService, AUTH_SETTINGS],
      useFactory: (config: ConfigService, settings: AuthSettings): AuthPolicy | null =>
        settings.provider === 'cognito'
          ? null
          : {
              maxLoginAttempts: positiveInteger(config, 'LOGIN_MAX_ATTEMPTS'),
              lockDurationMinutes: positiveInteger(config, 'LOGIN_LOCK_MINUTES'),
            },
    },
    {
      provide: JWT_CONFIG,
      inject: [ConfigService, AUTH_SETTINGS],
      useFactory: (config: ConfigService, settings: AuthSettings): JwtConfig | null =>
        settings.provider === 'cognito'
          ? null
          : {
              secret: config.getOrThrow<string>('JWT_SECRET'),
              accessTtlSeconds: positiveInteger(config, 'JWT_ACCESS_TTL'),
              refreshTtlSeconds: positiveInteger(config, 'JWT_REFRESH_TTL'),
            },
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ResourceAccessGuard },
  ],
  exports: [AuthService, TOKEN_SERVICE],
})
export class AuthModule {}

function positiveInteger(config: ConfigService, key: string): number {
  const value = Number(config.getOrThrow<string>(key));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương.`);
  }
  return value;
}
