import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { EnvConfig } from '../common/config/env.schema';
import {
  ConsumedEventMessage,
  EventConsumer,
} from '../common/kafka/interfaces/event-consumer.interface';
import { MailerService } from './mailer.service';
import { NotificationsConsumerService } from './notifications-consumer.service';

describe('NotificationsConsumerService', () => {
  let eventConsumer: jest.Mocked<Pick<EventConsumer, 'subscribe'>>;
  let mailerService: jest.Mocked<Pick<MailerService, 'send'>>;
  let configService: { get: jest.Mock };
  let dataSource: { query: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let service: NotificationsConsumerService;
  let claimedIds: Set<string>;

  const buildMessage = (
    overrides: Partial<Record<string, unknown>> = {},
  ): ConsumedEventMessage => ({
    key: 'entry-1',
    value: JSON.stringify({
      id: 'event-1',
      eventType: 'deposit.completed',
      aggregateId: 'entry-1',
      payload: { recipientEmail: 'jane@example.com', currency: 'USD', amount: '100.00' },
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }),
  });

  beforeEach(() => {
    eventConsumer = { subscribe: jest.fn().mockResolvedValue(undefined) };
    mailerService = { send: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue('flowpay-notifications') };
    logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };

    // Mimics the real "INSERT ... ON CONFLICT DO NOTHING RETURNING event_id" claim: the first
    // call for a given id succeeds (returns a row), every subsequent call for the same id is a
    // no-op (returns nothing) -- exactly what at-least-once redelivery needs to be idempotent.
    claimedIds = new Set();
    dataSource = {
      query: jest.fn((_sql: string, params: [string]) => {
        const [eventId] = params;
        if (claimedIds.has(eventId)) {
          return Promise.resolve([]);
        }
        claimedIds.add(eventId);
        return Promise.resolve([{ event_id: eventId }]);
      }),
    };

    service = new NotificationsConsumerService(
      eventConsumer,
      mailerService as unknown as MailerService,
      configService as unknown as ConfigService<EnvConfig, true>,
      dataSource as never,
      logger as unknown as PinoLogger,
    );
  });

  it('subscribes to the flowpay.events topic with the configured consumer group on init', () => {
    service.onModuleInit();

    expect(eventConsumer.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'flowpay.events', groupId: 'flowpay-notifications' }),
    );
  });

  it('retries with backoff instead of crashing when the initial subscribe fails', async () => {
    jest.useFakeTimers();
    eventConsumer.subscribe
      .mockRejectedValueOnce(new Error('topic does not exist yet'))
      .mockResolvedValueOnce(undefined);

    expect(() => service.onModuleInit()).not.toThrow();
    await jest.advanceTimersByTimeAsync(0); // let the rejected promise's .catch run
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(eventConsumer.subscribe).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000); // the scheduled retry
    expect(eventConsumer.subscribe).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('sends exactly one email when the same event is delivered twice (at-least-once)', async () => {
    const message = buildMessage();

    await service.handleMessage(message);
    await service.handleMessage(message);

    expect(mailerService.send).toHaveBeenCalledTimes(1);
    expect(mailerService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: 'Deposit received',
        text: expect.stringContaining('100.00 USD') as string,
      }),
    );
  });

  it('skips sending when the event has no recipientEmail', async () => {
    const message = buildMessage({ payload: { currency: 'USD', amount: '5.00' } });

    await service.handleMessage(message);

    expect(mailerService.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('skips sending when the event type has no known template', async () => {
    const message = buildMessage({ eventType: 'something.unrecognized' });

    await service.handleMessage(message);

    expect(mailerService.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs and skips an unparseable message without throwing', async () => {
    await expect(
      service.handleMessage({ key: null, value: 'not valid json' }),
    ).resolves.toBeUndefined();

    expect(mailerService.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
