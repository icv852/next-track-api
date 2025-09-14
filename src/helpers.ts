import type { Pool } from "mysql2/promise"

export async function query<T = any>(pool: Pool, sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}