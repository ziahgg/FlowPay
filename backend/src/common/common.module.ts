import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/validate';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { LoggerModule } from './logging/logger.module';
import { RequestIdMiddleware } from './middleware/request-id.middleware';

/**
 * @Global() so every feature module gets a sane default rate limit (see ThrottlerModule.forRoot
 * below) without importing this module itself -- the same reasoning nestjs-pino's own LoggerModule
 * already relies on for PinoLogger being injectable everywhere with no explicit import.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      cache: true,
    }),
    LoggerModule,
    // A generous baseline (60 requests/min per IP) applied to every route via APP_GUARD below --
    // an abuse safety net, not a UX constraint. Auth's register/login override this with a much
    // stricter limit via @Throttle({ default: { limit: 5, ttl: 60_000 } }) since brute-force
    // protection needs to be aggressive specifically there (see auth.controller.ts).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  exports: [ConfigModule, LoggerModule, ThrottlerModule],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
