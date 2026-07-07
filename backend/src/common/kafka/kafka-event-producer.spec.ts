import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../config/env.schema';
import { KafkaEventProducer } from './kafka-event-producer';

const eventHandlers = new Map<string, () => void>();

const mockProducer = {
  events: { CONNECT: 'producer.connect', DISCONNECT: 'producer.disconnect' },
  on: jest.fn((event: string, handler: () => void) => {
    eventHandlers.set(event, handler);
  }),
  connect: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => mockProducer,
  })),
}));

describe('KafkaEventProducer', () => {
  let configService: { get: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock };
  let service: KafkaEventProducer;

  beforeEach(() => {
    jest.clearAllMocks();
    eventHandlers.clear();
    configService = {
      get: jest.fn((key: string) =>
        key === 'KAFKA_CLIENT_ID' ? 'flowpay-backend' : 'localhost:9092',
      ),
    };
    logger = { setContext: jest.fn(), error: jest.fn() };
    service = new KafkaEventProducer(
      configService as unknown as ConfigService<EnvConfig, true>,
      logger as unknown as PinoLogger,
    );
  });

  it('connects on init without blocking or throwing', () => {
    mockProducer.connect.mockResolvedValue(undefined);

    expect(() => service.onModuleInit()).not.toThrow();

    expect(mockProducer.connect).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff instead of crashing the app when the initial connect fails', async () => {
    jest.useFakeTimers();
    mockProducer.connect
      .mockRejectedValueOnce(new Error('broker unreachable'))
      .mockResolvedValueOnce(undefined);

    expect(() => service.onModuleInit()).not.toThrow();
    await jest.advanceTimersByTimeAsync(0); // let the rejected promise's .catch run
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(mockProducer.connect).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000); // the scheduled retry
    expect(mockProducer.connect).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('sends a message via the underlying kafkajs producer', async () => {
    await service.send({ topic: 'flowpay.events', key: 'agg-1', value: '{}' });

    expect(mockProducer.send).toHaveBeenCalledWith({
      topic: 'flowpay.events',
      messages: [{ key: 'agg-1', value: '{}' }],
    });
  });

  it('disconnects on module destroy', async () => {
    await service.onModuleDestroy();

    expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports isConnected() based on the underlying producer CONNECT/DISCONNECT events', () => {
    expect(service.isConnected()).toBe(false);

    eventHandlers.get('producer.connect')?.();
    expect(service.isConnected()).toBe(true);

    eventHandlers.get('producer.disconnect')?.();
    expect(service.isConnected()).toBe(false);
  });
});
