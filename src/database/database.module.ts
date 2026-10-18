import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './data-source-options.js';

/**
 * Owns the database connection wiring for the whole application.
 *
 * Feature modules register their own entities via `TypeOrmModule.forFeature`
 * and inject repositories; they never configure the connection themselves.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDataSourceOptions(config.getOrThrow<string>('DATABASE_URL')),
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
