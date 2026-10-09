import { DatabaseSync } from "node:sqlite";
import type { D1 } from "../functions/api/taps.ts";

/** Just enough of Cloudflare D1 on top of node:sqlite. */
export function fakeD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(args as any[])),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
  });
  return { prepare: (sql) => stmt(sql), batch: async (s: any[]) => { for (const x of s) await x.run(); } } as D1;
}
