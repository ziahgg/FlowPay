import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { UserRole } from '../users/entities/user-role.enum';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail' | 'create' | 'toProfile'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign'>>;

  const user: User = {
    id: 'user-id-1',
    email: 'someone@example.com',
    passwordHash: 'hashed-password',
    role: UserRole.USER,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const profile = {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      toProfile: jest.fn().mockReturnValue(profile),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('hashes the password and creates a user with the "user" role', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(user);
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-password');

      const result = await service.register({
        email: 'someone@example.com',
        password: 'password123',
      });

      expect(argon2.hash).toHaveBeenCalledWith('password123');
      expect(usersService.create).toHaveBeenCalledWith(
        'someone@example.com',
        'hashed-password',
        UserRole.USER,
      );
      expect(result).toEqual({ accessToken: 'signed-jwt', user: profile });
    });

    it('throws ConflictException when the email is already registered', async () => {
      usersService.findByEmail.mockResolvedValue(user);

      await expect(
        service.register({ email: user.email, password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns an access token and profile on successful login', async () => {
      usersService.findByEmail.mockResolvedValue(user);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: user.email, password: 'password123' });

      expect(argon2.verify).toHaveBeenCalledWith(user.passwordHash, 'password123');
      expect(result).toEqual({ accessToken: 'signed-jwt', user: profile });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      usersService.findByEmail.mockResolvedValue(user);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: user.email, password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
