import initSqlJs, { type BindParams, type Database, type SqlJsStatic } from "sql.js";

type Bound = string | number | Uint8Array | null;

function normalize(value: unknown): Bound {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || value instanceof Uint8Array) return value;
  throw new TypeError(`Unsupported test D1 binding: ${typeof value}`);
}

class TestD1Statement {
  constructor(private readonly owner: TestD1Database, private readonly sql: string, private readonly values: Bound[] = []) {}

  bind(...values: unknown[]) {
    return new TestD1Statement(this.owner, this.sql, values.map(normalize));
  }

  private rows<T>() {
    const statement = this.owner.raw.prepare(this.sql);
    try {
      if (this.values.length) statement.bind(this.values as BindParams);
      const results: T[] = [];
      while (statement.step()) results.push(statement.getAsObject() as T);
      return results;
    } finally {
      statement.free();
    }
  }

  async all<T>() {
    return { success: true, results: this.rows<T>(), meta: {} };
  }

  async first<T>(column?: string) {
    const first = this.rows<Record<string, unknown>>()[0];
    if (!first) return null;
    return (column ? first[column] : first) as T;
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    this.owner.raw.run(this.sql, this.values as BindParams);
    return { success: true, results: [], meta: { changes: this.owner.raw.getRowsModified() } };
  }
}

export class TestD1Database {
  private constructor(readonly raw: Database) {}

  static async create() {
    const SQL: SqlJsStatic = await initSqlJs();
    return new TestD1Database(new SQL.Database());
  }

  prepare(sql: string) {
    return new TestD1Statement(this, sql);
  }

  async batch(statements: TestD1Statement[]) {
    this.raw.run("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => statement.runSync());
      this.raw.run("COMMIT");
      return results;
    } catch (error) {
      this.raw.run("ROLLBACK");
      throw error;
    }
  }

  async exec(sql: string) {
    this.raw.exec(sql);
    return { count: 0, duration: 0 };
  }

  close() {
    this.raw.close();
  }
}
