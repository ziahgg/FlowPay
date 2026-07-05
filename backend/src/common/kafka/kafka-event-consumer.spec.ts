import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../config/env.schema';
import { KafkaEventConsumer } from './kafka-event-consumer';

let crashHandler: ((event: { payload: { error: Error } }) => void) | null = null;

const mockConsumer = {
  events: { CRASH: 'consumer.crash' },
  on: jest.fn((_event: string, handler: (event: { payload: { error: Error } }) => void) => {
    crashHandler = handler;
  }),
  connect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    consumer: () => mockConsumer,
  })),
}));

describe('KafkaEventConsumer', () => {
  let configService: { get: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock };
  let service: KafkaEventConsumer;
  let onMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    crashHandler = null;
    configService = {
      get: jest.fn((key: string) =>
        key === 'KAFKA_CLIENT_ID' ? 'flowpay-backend' : 'localhost:9092',
      ),
    };
    logger = { setContext: jest.fn(), error: jest.fn() };
    onMessage = jest.fn().mockResolvedValue(undefined);
    service = new KafkaEventConsumer(
      configService as unknown as ConfigService<EnvConfig, true>,
      logger as unknown as PinoLogger,
    );
  });

  it('connects, subscribes, and runs against the requested topic and group', async () => {
    await service.subscribe({
      topic: 'flowpay.events',
      groupId: 'flowpay-notifications',
      onMessage,
    });

    expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
    expect(mockConsumer.subscribe).toHaveBeenCalledWith({
      topic: 'flowpay.events',
      fromBeginning: false,
    });
    expect(mockConsumer.run).toHaveBeenCalledTimes(1);
  });

  it('resubscribes with backoff instead of silently going dark when the consumer crashes', async () => {
    jest.useFakeTimers();
    await service.subscribe({
      topic: 'flowpay.events',
      groupId: 'flowpay-notifications',
      onMessage,
    });

    expect(crashHandler).not.toBeNull();
    crashHandler?.({ payload: { error: new Error('group coordinator not available') } });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(mockConsumer.connect).toHaveBeenCalledTimes(1); // not yet -- retry is scheduled, not immediate

    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockConsumer.connect).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('stops resubscribing once the module has been destroyed', async () => {
    jest.useFakeTimers();
    await service.subscribe({
      topic: 'flowpay.events',
      groupId: 'flowpay-notifications',
      onMessage,
    });

    crashHandler?.({ payload: { error: new Error('boom') } });
    await service.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockConsumer.connect).toHaveBeenCalledTimes(1); // no resubscribe after destroy

    jest.useRealTimers();
  });

  it('disconnects the underlying consumer on module destroy', async () => {
    await service.subscribe({
      topic: 'flowpay.events',
      groupId: 'flowpay-notifications',
      onMessage,
    });

    await service.onModuleDestroy();

    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
  });
});
