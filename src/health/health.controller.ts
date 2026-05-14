import { Controller, Get, Inject } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  @Get()
  async getHealth(): Promise<{ status: "ok" }> {
    await this.databaseService.ping();
    return { status: "ok" };
  }
}
