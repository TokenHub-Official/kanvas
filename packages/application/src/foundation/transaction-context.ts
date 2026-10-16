declare const transactionContextBrand: unique symbol;

export interface TransactionContext {
  readonly [transactionContextBrand]: true;
}

export interface TransactionManager {
  run<TResult>(
    callback: (context: TransactionContext) => Promise<TResult>,
  ): Promise<TResult>;
}
