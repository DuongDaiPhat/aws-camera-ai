import { Global, Module, OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolConfig } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Pool => {
        const logger = new Logger('DatabaseModule');
        const databaseUrl = configService.get<string>('DATABASE_URL');

        const poolConfig: PoolConfig = databaseUrl
          ? { connectionString: databaseUrl }
          : {
              host: configService.get<string>('POSTGRES_HOST', 'localhost'),
              port: configService.get<number>('POSTGRES_PORT', 5432),
              database: configService.get<string>('POSTGRES_DB', 'camerai'),
              user: configService.get<string>('POSTGRES_USER', 'camerai'),
              password: configService.get<string>('POSTGRES_PASSWORD', 'change_me_local_only'),
            };

        const pool = new Pool({
          ...poolConfig,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });

        pool.on('error', (err) => {
          logger.error('Loi bat ngo tren PostgreSQL connection pool', err);
        });

        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Dong ket noi PostgreSQL connection pool...');
    await this.pool.end();
  }
}
