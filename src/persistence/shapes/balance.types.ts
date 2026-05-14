export interface BalanceRecord {
  id: string;
  employeeId: string;
  locationId: string;
  availableDays: number;
  sourceVersion: string | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBalanceProjectionInput {
  id?: string;
  employeeId: string;
  locationId: string;
  availableDays: number;
  sourceVersion?: string | null;
  lastSyncedAt: string;
  createdAt?: string;
  updatedAt?: string;
}
