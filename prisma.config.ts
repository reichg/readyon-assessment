/// <reference types="node" />

import { defineConfig } from "prisma/config";
import { getConfiguredDatabaseUrl } from "./src/database/database.constants";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: getConfiguredDatabaseUrl(),
  },
});
