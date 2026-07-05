import { PinoLogger } from 'nestjs-pino';
import { OutboxEvent } from './entities/outbox-event.entity';
import { EventProducer } from '../kafka/interfaces/event-producer.interface';
import { OutboxPublisherService } from './outbox-publisher.service';

describe('OutboxPublisherService', () => {
  let eventProducer: jest.Mocked<Pick<EventProducer, 'send'>>;
  let dataSource: { transaction: jest.Mock };
  let outboxRepository: { find: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock };
  let service: OutboxPublisherService;

  const buildRow = (overrides: Partial<OutboxEvent> = {}): OutboxEvent => ({
    id: 'event-1',
    topic: 'flowpay.events',
    eventType: 'deposit.completed',
    aggregateId: 'entry-1',
    payload: { recipientEmail: 'jane@example.com', amount: '100.00', currency: 'USD' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedAt: null,
    ...overrides,
  });

  const managerFor = (rows: Record<string, OutboxEvent | null>) => ({
    findOne: jest.fn((_entity: unknown, options: { where: { id: string } }) =>
      Promise.resolve(rows[options.where.id] ?? null),
    ),
    save: jest.fn((row: OutboxEvent) => Promise.resolve(row)),
  });

  beforeEach(() => {
    eventProducer = { send: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn() };
    outboxRepository = { find: jest.fn() };
    logger = { setContext: jest.fn(), error: jest.fn() };

    service = new OutboxPublisherService(
      dataSource as never,
      outboxRepository as never,
      eventProducer,
      logger as unknown as PinoLogger,
    );
  });

  it('publishes an unpublished row and marks it published', async () => {
    const row = buildRow();
    outboxRepository.find.mockResolvedValue([row]);
    const manager = managerFor({ 'event-1': row });
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

    const count = await service.publishBatch();

    expect(count).toBe(1);
    expect(eventProducer.send).toHaveBeenCalledWith({
      topic: 'flowpay.events',
      key: 'entry-1',
      value: JSON.stringify({
        id: 'event-1',
        eventType: 'deposit.completed',
        aggregateId: 'entry-1',
        payload: row.payload,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(manager.save).toHaveBeenCalledWith(row);
  });

  it('is a no-op for a row already published by a concurrent publisher', async () => {
    outboxRepository.find.mockResolvedValue([buildRow()]);
    const manager = managerFor({ 'event-1': null }); // WHERE publishedAt IS NULL no longer matches
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

    const count = await service.publishBatch();

    expect(count).toBe(0);
    expect(eventProducer.send).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('leaves a row unpublished when the producer throws, and continues to the next row', async () => {
    const failing = buildRow({ id: 'event-1' });
    const healthy = buildRow({ id: 'event-2', aggregateId: 'entry-2' });
    outboxRepository.find.mockResolvedValue([failing, healthy]);

    eventProducer.send.mockImplementationOnce(() => Promise.reject(new Error('broker down')));

    const manager = managerFor({ 'event-1': failing, 'event-2': healthy });
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) => cb(manager));

    const count = await service.publishBatch();

    expect(count).toBe(1);
    expect(failing.publishedAt).toBeNull();
    expect(healthy.publishedAt).toBeInstanceOf(Date);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
