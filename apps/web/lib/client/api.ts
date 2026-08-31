"use client";

import type { ApiResponse } from "../../packages/contracts/src";

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  return document.cookie.match(/(?:^|;\s*)ls_csrf=([^;]+)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)ls_csrf=([^;]+)/)![1]) : null;
}

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) { super(message); }
}

export async function api<T>(path: string, options: RequestInit & { idempotent?: boolean } = {}): Promise<T> {
  const headers = new Headers(options.headers); const method = (options.method ?? "GET").toUpperCase();
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = csrfToken(); if (csrf) headers.set("x-csrf-token", csrf);
    if (options.idempotent !== false) headers.set("idempotency-key", globalThis.crypto.randomUUID());
  }
  const retryable = ["GET", "HEAD"].includes(method) || options.idempotent !== false;
  const attempts = retryable ? 3 : 1;
  let response: Response | null = null; let networkError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(`/api/v1/${path.replace(/^\//, "")}`, { ...options, headers, credentials: "same-origin", cache: "no-store" });
      if (![502, 503, 504].includes(response.status) || attempt === attempts - 1) break;
    } catch (error) {
      response = null;
      networkError = error;
      if (attempt === attempts - 1) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
  }
  if (!response) throw new ApiClientError("NETWORK_ERROR", networkError instanceof Error ? networkError.message : "The casino server could not be reached", 0);
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as ApiResponse<T>;
  if (!payload.ok) throw new ApiClientError(payload.error.code, payload.error.message, response.status, payload.error.details);
  return payload.data;
}

export function post<T>(path: string, body: unknown): Promise<T> { return api<T>(path, { method: "POST", body: JSON.stringify(body) }); }
export function patch<T>(path: string, body: unknown): Promise<T> { return api<T>(path, { method: "PATCH", body: JSON.stringify(body) }); }
