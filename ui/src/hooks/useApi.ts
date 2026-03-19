import { useState, useCallback, useRef, useEffect } from 'react';
import { config } from '@/config';

// ---------------------------------------------------------------------------
// Auth token management — shared across all hooks
// ---------------------------------------------------------------------------

let authToken: string | null = null;

/** Set the JWT auth token to be sent with all API requests */
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Get the current auth token (for inspection/debugging) */
export function getAuthToken(): string | null {
  return authToken;
}

// ---------------------------------------------------------------------------
// Backend connection status — shared across all hooks
// ---------------------------------------------------------------------------

type BackendStatus = 'connected' | 'disconnected' | 'checking';

let _backendStatus: BackendStatus = 'checking';
let _statusListeners: Array<() => void> = [];

function notifyStatusListeners() {
  for (const fn of _statusListeners) fn();
}

function setBackendStatus(s: BackendStatus) {
  if (_backendStatus !== s) {
    _backendStatus = s;
    notifyStatusListeners();
  }
}

// ---------------------------------------------------------------------------
// Generic fetch wrapper — unwraps { success, data } envelope
// ---------------------------------------------------------------------------

interface ApiError {
  status: number;
  message: string;
}

/**
 * Envelope that the backend wraps all JSON responses in.
 * Successful responses: `{ success: true, data: T }`
 * Error responses: `{ success: false, error: string }`
 */
interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = path.startsWith('http') ? path : `${config.backendUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    // Try to parse as JSON envelope for structured errors
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.error) {
        const err: ApiError = { status: res.status, message: parsed.error };
        throw err;
      }
    } catch (e) {
      if ((e as ApiError).status) throw e; // re-throw if already ApiError
    }
    const err: ApiError = { status: res.status, message: body };
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  const json = await res.json();

  // Unwrap { success, data } envelope if present
  if (json && typeof json === 'object' && 'success' in json) {
    const envelope = json as ApiEnvelope<T>;
    if (envelope.success && 'data' in envelope) {
      // Mark backend as connected on successful response
      setBackendStatus('connected');
      return envelope.data as T;
    }
    if (!envelope.success && envelope.error) {
      // Backend returned a structured error — still means it's reachable
      setBackendStatus('connected');
      const err: ApiError = { status: res.status, message: envelope.error };
      throw err;
    }
  }

  // Non-envelope response (e.g. /health) — return as-is
  setBackendStatus('connected');
  return json as T;
}

// ---------------------------------------------------------------------------
// useQuery — fetch data on mount / refetch, with demo-data fallback support
// ---------------------------------------------------------------------------

export interface QueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** True when the data came from backend (not null / not fallback) */
  isFromBackend: boolean;
}

export function useQuery<T>(
  path: string | null,
  deps: unknown[] = [],
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!path) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(path);
      if (mountedRef.current) {
        setData(result);
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setError(
          (e as ApiError).message ?? (e as Error).message ?? 'Request failed',
        );
        // If this was a network-level error (not a 4xx/5xx with a body),
        // mark backend as disconnected
        if (!(e as ApiError).status) {
          setBackendStatus('disconnected');
        }
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
    isFromBackend: data !== null,
  };
}

// ---------------------------------------------------------------------------
// useMutation — POST / PUT / DELETE actions
// ---------------------------------------------------------------------------

export interface MutationResult<TInput, TOutput = void> {
  mutate: (input: TInput) => Promise<TOutput>;
  isLoading: boolean;
  error: string | null;
}

export function useMutation<TInput, TOutput = void>(
  pathOrFn: string | ((input: TInput) => string),
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
): MutationResult<TInput, TOutput> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput> => {
      const path =
        typeof pathOrFn === 'function' ? pathOrFn(input) : pathOrFn;

      setIsLoading(true);
      setError(null);
      try {
        const result = await apiFetch<TOutput>(path, {
          method,
          body: JSON.stringify(input),
        });
        return result;
      } catch (e: unknown) {
        const msg =
          (e as ApiError).message ?? (e as Error).message ?? 'Request failed';
        setError(msg);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [pathOrFn, method],
  );

  return { mutate, isLoading, error };
}

// ---------------------------------------------------------------------------
// useBackendStatus — poll /health to track connectivity
// ---------------------------------------------------------------------------

export interface BackendStatusResult {
  status: BackendStatus;
  lastChecked: Date | null;
}

export function useBackendStatus(pollIntervalMs: number = 10_000): BackendStatusResult {
  const [status, setStatus] = useState<BackendStatus>(_backendStatus);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Subscribe to global status changes
  useEffect(() => {
    const handler = () => setStatus(_backendStatus);
    _statusListeners.push(handler);
    return () => {
      _statusListeners = _statusListeners.filter((fn) => fn !== handler);
    };
  }, []);

  // Poll /health endpoint
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const url = `${config.backendUrl}/health`;
        const res = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (!cancelled) {
          if (res.ok) {
            setBackendStatus('connected');
          } else {
            setBackendStatus('disconnected');
          }
          setLastChecked(new Date());
        }
      } catch {
        if (!cancelled) {
          setBackendStatus('disconnected');
          setLastChecked(new Date());
        }
      }
    };

    // Check immediately on mount
    check();

    // Then poll at interval
    const timer = setInterval(check, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollIntervalMs]);

  return { status, lastChecked };
}

export { apiFetch };
