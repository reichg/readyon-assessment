import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const DEFAULT_PORT = 3000;

export function getProjectRoot(): string {
  return resolve(__dirname, "..");
}

export function getProjectEnvironmentPath(
  projectRoot = getProjectRoot(),
): string {
  return resolve(projectRoot, ".env");
}

export function loadEnvironmentFileIfPresent(
  environmentFilePath: string,
): boolean {
  if (!existsSync(environmentFilePath)) {
    return false;
  }

  const parsedEnvironment = parseEnv(readFileSync(environmentFilePath, "utf8"));

  for (const [key, value] of Object.entries(parsedEnvironment)) {
    if (!hasEnvironmentValue(key)) {
      process.env[key] = value;
    }
  }

  return true;
}

export function loadProjectEnvironment(
  projectRoot = getProjectRoot(),
): boolean {
  return loadEnvironmentFileIfPresent(getProjectEnvironmentPath(projectRoot));
}

export function isMockHcmHttpEnabled(): boolean {
  return process.env.READYON_ENABLE_MOCK_HCM_HTTP === "true";
}

export function getPort(): number {
  const configuredPort = process.env.PORT?.trim();

  if (!configuredPort) {
    return DEFAULT_PORT;
  }

  const port = Number(configuredPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function hasEnvironmentValue(key: string): boolean {
  return Object.keys(process.env).some(
    (environmentKey) => environmentKey.toLowerCase() === key.toLowerCase(),
  );
}
