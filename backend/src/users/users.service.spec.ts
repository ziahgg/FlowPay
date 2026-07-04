import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { UserRole } from './entities/user-role.enum';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Pick<Repository<User>, 'findOne' | 'create' | 'save'>>;

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getRepositoryToken(User), useValue: repository }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('looks up users by lowercased email', async () => {
    repository.findOne.mockResolvedValue(null);

    await service.findByEmail('Someone@Example.com');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { email: 'someone@example.com' },
    });
  });

  it('creates a user with a lowercased email', async () => {
    const created = { id: '1' } as User;
    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue(created);

    const result = await service.create('Someone@Example.com', 'hash', UserRole.ADMIN);

    expect(repository.create).toHaveBeenCalledWith({
      email: 'someone@example.com',
      passwordHash: 'hash',
      role: UserRole.ADMIN,
    });
    expect(result).toBe(created);
  });

  it('excludes the password hash when mapping to a profile', () => {
    const user: User = {
      id: '1',
      email: 'someone@example.com',
      passwordHash: 'super-secret-hash',
      role: UserRole.USER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const profile = service.toProfile(user);

    expect(profile).toEqual({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });
});
