import type { Db } from './client';

/** Connection usable inside withExclusiveTransactionAsync (txn) or on the main db handle. */
export type SqlRunner = Pick<Db, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;