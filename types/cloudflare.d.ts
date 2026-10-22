interface D1Meta { changes: number; last_row_id: number; duration: number; }
interface D1Result<T = unknown> { success: boolean; results: T[]; meta: D1Meta; }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}
interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
}
interface R2Bucket {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}
