import 'dotenv/config';

import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation';

const env = validateEnv(process.env);

const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,

  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],

  synchronize: false,
  migrationsRun: false,
  migrationsTableName: 'migrations',
  logging: ['error', 'warn'],
});

export default AppDataSource;
