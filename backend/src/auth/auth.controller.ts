import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProblemDetailsDto } from '../common/dto/problem-details.dto';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// Stricter than the app-wide default (60/min, see CommonModule) -- brute-force protection on
// register/login needs to be aggressive specifically here, not applied everywhere.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new user and receive an access token' })
  @ApiResponse({ status: 201, description: 'Registered', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'Email already registered', type: ProblemDetailsDto })
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({ status: 200, description: 'Logged in', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ProblemDetailsDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials', type: ProblemDetailsDto })
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }
}
