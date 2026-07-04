import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let query: jest.Mock;

  const buildModule = async (dataSourceMock: { query: jest.Mock }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: getDataSourceToken(),
          useValue: dataSourceMock,
        },
      ],
    }).compile();

    return module.get<HealthService>(HealthService);
  };

  it('reports db up when the query succeeds', async () => {
    query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    service = await buildModule({ query });

    await expect(service.check()).resolves.toEqual({ status: 'ok', db: 'up' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports db down when the query throws', async () => {
    query = jest.fn().mockRejectedValue(new Error('connection refused'));
    service = await buildModule({ query });

    await expect(service.check()).resolves.toEqual({ status: 'error', db: 'down' });
  });
});
