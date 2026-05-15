import { Module } from "@nestjs/common";
import { AppModule } from "./app.module";
import { MockHcmHttpModule } from "./hcm/mock-hcm-http.module";

@Module({
  imports: [AppModule, MockHcmHttpModule],
})
export class AppWithMockHcmModule {}
