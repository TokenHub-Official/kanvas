import type {
  TransactionContext,
  TransactionManager,
} from "@kanvas/application";
import type { Pool, PoolConnection } from "mysql2/promise";

export interface MysqlTransactionRuntime {
  readonly transactionManager: TransactionManager;
  connectionFor(context: TransactionContext): PoolConnection;
}

export function createMysqlTransactionRuntime(
  pool: Pool,
): MysqlTransactionRuntime {
  const connections = new WeakMap<object, PoolConnection>();

  const connectionFor = (context: TransactionContext): PoolConnection => {
    const connection = connections.get(context);
    if (!connection) {
      throw new Error(
        "Transaction context is not owned by this database runtime.",
      );
    }
    return connection;
  };

  const transactionManager: TransactionManager = Object.freeze({
    async run<TResult>(
      callback: (context: TransactionContext) => Promise<TResult>,
    ): Promise<TResult> {
      const connection = await pool.getConnection();
      const context = Object.freeze({}) as TransactionContext;
      connections.set(context, connection);
      try {
        await connection.beginTransaction();
        const result = await callback(context);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connections.delete(context);
        connection.release();
      }
    },
  });

  return Object.freeze({
    transactionManager,
    connectionFor,
  });
}
