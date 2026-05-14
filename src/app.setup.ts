import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { HttpTelemetryInterceptor } from "./telemetry/http-telemetry.interceptor";

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(app.get(HttpTelemetryInterceptor));
}
