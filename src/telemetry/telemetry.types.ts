export type TelemetryValue = string | number | boolean | null | undefined;

export interface TelemetryEvent {
  event: string;
  component: string;
  operation: string;
  outcome: string;
  durationMs?: number;
  requestId?: string;
  [key: string]: TelemetryValue;
}
