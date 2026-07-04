export interface IdempotentHandlerResult<T> {
  body: T;
  entryId?: string;
}

export interface RunIdempotentParams<T> {
  userId: string;
  key: string;
  endpoint: string;
  requestPayload: unknown;
  successStatus: number;
  handler: () => Promise<IdempotentHandlerResult<T>>;
}

export interface RunIdempotentResult<T> {
  body: T;
  statusCode: number;
  replayed: boolean;
}
