export interface ApiSuccess<T> { ok: true; data: T; requestId: string }
export interface ApiFailure { ok: false; error: { code: string; message: string; details?: unknown }; requestId: string }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface RealtimeEnvelope<TPublic = unknown, TPrivate = unknown> {
  id: string;
  version: number;
  tableId: string;
  roundId: string | null;
  type: string;
  timestamp: string;
  publicPayload: TPublic;
  privatePayload?: TPrivate;
}

export interface SessionUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  balance: number;
  roles: string[];
  ageConfirmed: boolean;
  isDevelopment: boolean;
}

export interface TableSummary {
  id: string;
  name: string;
  gameType: string;
  status: string;
  visibility: string;
  maxSeats: number;
  seatedCount: number;
  spectatorCount: number;
  minBet: number;
  maxBet: number;
  ownerDisplayName: string;
  updatedAt: string;
}
