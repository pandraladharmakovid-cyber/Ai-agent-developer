'use strict';

/**
 * AI Developer Agent — Level 2
 * PostgreSQL / Aiven Database Layer
 *
 * All database credentials come from:
 *   DATABASE_URL
 *   or
 *   AIVEN_DATABASE_URL
 *
 * Never hardcode credentials here.
 */

import pg from 'pg';

const { Pool } = pg;

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.AIVEN_DATABASE_URL ||
  '';

const DATABASE_SSL =
  (
    process.env.DATABASE_SSL ||
    'true'
  ).toLowerCase() !== 'false';

const POOL_MIN =
  Number.parseInt(
    process.env.DATABASE_POOL_MIN ||
      '0',
    10,
  );

const POOL_MAX =
  Number.parseInt(
    process.env.DATABASE_POOL_MAX ||
      '10',
    10,
  );

const CONNECTION_TIMEOUT =
  Number.parseInt(
    process.env.DATABASE_CONNECTION_TIMEOUT_MS ||
      '10000',
    10,
  );

const IDLE_TIMEOUT =
  Number.parseInt(
    process.env.DATABASE_IDLE_TIMEOUT_MS ||
      '30000',
    10,
  );

/* -------------------------------------------------------------------------- */
/* Pool                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The installed pg type definitions in this project
 * expose Pool primarily as a runtime constructor.
 *
 * We therefore keep the runtime pool reference flexible
 * instead of forcing an incompatible InstanceType type.
 */

let pool: any = null;

function getConnectionString(): string {
  try {
    const url = new URL(DATABASE_URL);

    url.searchParams.delete(
      'sslmode',
    );

    return url.toString();
  } catch {
    return DATABASE_URL;
  }
}

function getPool(): any {
  if (!DATABASE_URL) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL or AIVEN_DATABASE_URL in .env.',
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString:
        getConnectionString(),

      min:
        Number.isFinite(POOL_MIN)
          ? Math.max(
              0,
              POOL_MIN,
            )
          : 0,

      max:
        Number.isFinite(POOL_MAX)
          ? Math.min(
              Math.max(
                1,
                POOL_MAX,
              ),
              50,
            )
          : 10,

      connectionTimeoutMillis:
        Math.min(
          Math.max(
            CONNECTION_TIMEOUT,
            1_000,
          ),
          60_000,
        ),

      idleTimeoutMillis:
        Math.min(
          Math.max(
            IDLE_TIMEOUT,
            1_000,
          ),
          300_000,
        ),

      ssl:
        DATABASE_SSL
          ? {
              rejectUnauthorized:
                false,
            }
          : false,

      application_name:
        'ai-developer-agent-level-2',
    });

    pool.on(
      'error',
      (error: unknown) => {
        console.error(
          '[DATABASE] Idle client error:',
          error,
        );
      },
    );
  }

  return pool;
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface QueryResultRow {
  [key: string]: unknown;
}

export interface DatabaseHealth {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Execute a parameterized SQL query.
 *
 * Always pass user/model-controlled values
 * through the parameters array.
 */
export async function query<
  T extends QueryResultRow = QueryResultRow,
>(
  text: string,
  values: unknown[] = [],
): Promise<{
  rows: T[];
  rowCount: number;
}> {
  if (!text.trim()) {
    throw new Error(
      'Database query cannot be empty.',
    );
  }

  if (text.length > 100_000) {
    throw new Error(
      'Database query is too large.',
    );
  }

  const database =
    getPool();

  const result =
    await database.query(
      text,
      values,
    );

  return {
    rows:
      result.rows as T[],

    rowCount:
      result.rowCount || 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Single row                                                                 */
/* -------------------------------------------------------------------------- */

export async function queryOne<
  T extends QueryResultRow = QueryResultRow,
>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result =
    await query<T>(
      text,
      values,
    );

  return (
    result.rows[0] ||
    null
  );
}

/* -------------------------------------------------------------------------- */
/* Transaction                                                                 */
/* -------------------------------------------------------------------------- */

export async function transaction<T>(
  callback: (
    client: any,
  ) => Promise<T>,
): Promise<T> {
  const database =
    getPool();

  const client =
    await database.connect();

  try {
    await client.query(
      'BEGIN',
    );

    const result =
      await callback(client);

    await client.query(
      'COMMIT',
    );

    return result;
  } catch (error) {
    try {
      await client.query(
        'ROLLBACK',
      );
    } catch (
      rollbackError
    ) {
      console.error(
        '[DATABASE] Rollback failed:',
        rollbackError,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Health check                                                               */
/* -------------------------------------------------------------------------- */

export async function healthCheck(): Promise<DatabaseHealth> {
  if (!DATABASE_URL) {
    return {
      configured: false,
      connected: false,
      error:
        'Database URL is not configured.',
    };
  }

  const startedAt =
    Date.now();

  try {
    await query(
      'SELECT 1 AS ok',
    );

    return {
      configured: true,
      connected: true,
      latencyMs:
        Date.now() -
        startedAt,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      latencyMs:
        Date.now() -
        startedAt,
      error:
        error instanceof Error
          ? error.message
          : 'Database connection failed.',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Database metadata                                                          */
/* -------------------------------------------------------------------------- */

export async function getDatabaseInfo(): Promise<{
  configured: boolean;
  connected: boolean;
  version?: string;
}> {
  if (!DATABASE_URL) {
    return {
      configured: false,
      connected: false,
    };
  }

  try {
    const result =
      await queryOne<{
        version: string;
      }>(
        'SELECT version() AS version',
      );

    return {
      configured: true,
      connected: true,
      version:
        result?.version,
    };
  } catch {
    return {
      configured: true,
      connected: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

export async function initializeDatabase(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn(
      '[DATABASE] No database URL configured. Database features are disabled.',
    );

    return;
  }

  const health =
    await healthCheck();

  if (!health.connected) {
    throw new Error(
      `Database initialization failed: ${
        health.error ||
        'Unable to connect.'
      }`,
    );
  }

  console.log(
    `[DATABASE] Connected successfully (${health.latencyMs}ms).`,
  );
}

/* -------------------------------------------------------------------------- */
/* Shutdown                                                                    */
/* -------------------------------------------------------------------------- */

export async function closeDatabase(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();

  pool = null;

  console.log(
    '[DATABASE] Connection pool closed.',
  );
}

/* -------------------------------------------------------------------------- */
/* Safe configuration                                                         */
/* -------------------------------------------------------------------------- */

export function getDatabaseConfig(): {
  configured: boolean;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
} {
  return {
    configured:
      Boolean(DATABASE_URL),

    ssl:
      DATABASE_SSL,

    poolMin:
      Math.max(
        0,
        POOL_MIN,
      ),

    poolMax:
      Math.min(
        Math.max(
          1,
          POOL_MAX,
        ),
        50,
      ),
  };
}