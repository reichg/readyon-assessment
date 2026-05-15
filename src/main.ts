import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import { AppWithMockHcmModule } from "./app-with-mock-hcm.module";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import {
  getPort,
  isMockHcmHttpEnabled,
  loadProjectEnvironment,
} from "./runtime-environment";

loadProjectEnvironment();

async function bootstrap(): Promise<void> {
  const rootModule = isMockHcmHttpEnabled() ? AppWithMockHcmModule : AppModule;

  const app = await NestFactory.create(rootModule);
  configureApp(app);
  await app.listen(getPort());
}

void bootstrap();
