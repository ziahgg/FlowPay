import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { KafkaEventProducer } from '../common/kafka/kafka-event-producer';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let query: jest.Mock;
  let isConnected: jest.Mock;

  const buildModule = async (
    dataSourceMock: { query: jest.Mock },
    kafkaEventProducerMock: { isConnected: jest.Mock },
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: getDataSourceToken(),
          useValue: dataSourceMock,
        },
        {
          provide: KafkaEventProducer,
          useValue: kafkaEventProducerMock,
        },
      ],
    }).compile();

    return module.get<HealthService>(HealthService);
  };

  it('reports ok/up when the db query succeeds and kafka is connected', async () => {
    query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    isConnected = jest.fn().mockReturnValue(true);
    service = await buildModule({ query }, { isConnected });

    await expect(service.check()).resolves.toEqual({ status: 'ok', db: 'up', kafka: 'up' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports status error and db down when the query throws, regardless of kafka', async () => {
    query = jest.fn().mockRejectedValue(new Error('connection refused'));
    isConnected = jest.fn().mockReturnValue(true);
    service = await buildModule({ query }, { isConnected });

    await expect(service.check()).resolves.toEqual({ status: 'error', db: 'down', kafka: 'up' });
  });

  it('reports kafka down without flipping the overall status when db is healthy', async () => {
    query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    isConnected = jest.fn().mockReturnValue(false);
    service = await buildModule({ query }, { isConnected });

    await expect(service.check()).resolves.toEqual({ status: 'ok', db: 'up', kafka: 'down' });
  });
});
