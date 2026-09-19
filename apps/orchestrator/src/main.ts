import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

const API_PREFIX = 'api/v1';

function parseAllowedOrigins(configuredOrigin: string): string[] {
  const origins = configuredOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return Array.from(
    new Set([
      ...origins,
      'http://localhost:3000',
      'http://localhost:3002',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3002',
    ]),
  );
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const webOrigin = configService.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
  app.enableCors({
    origin: parseAllowedOrigins(webOrigin),
    credentials: true,
  });

  const port = Number(configService.get<string>('PORT') ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Orchestrator dang chay tai http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
