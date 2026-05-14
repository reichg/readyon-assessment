import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { removeDatabaseFiles } from './database-path';

export async function createTestApp(databasePath: string): Promise<INestApplication> {
  process.env.READYON_DB_PATH = databasePath;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}

export async function closeTestApp(
  app: INestApplication | undefined,
  databasePath: string | undefined,
): Promise<void> {
  if (app) {
    await app.close();
  }

  delete process.env.READYON_DB_PATH;
  removeDatabaseFiles(databasePath);
}
