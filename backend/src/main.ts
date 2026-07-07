import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvConfig } from './common/config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<EnvConfig, true>);

  app.use(
    helmet({
      // Swagger UI at /api/docs (see below) renders its own inline <script>/<style> tags -- the
      // default CSP would block those. Every other route in this API returns JSON only, which CSP
      // doesn't apply to, so this relaxation is scoped to exactly what the docs page needs.
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );

  app.enableCors({
    origin: config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FlowPay API')
      .setDescription(
        'Simulated crypto & fiat payment and trading platform. All money, transfers, and market ' +
          'activity are simulated in Postgres -- no real currency, no real blockchain. Every ' +
          'endpoint is prefixed with /api/v1 (omitted from the paths below to match how routes ' +
          "are actually registered by NestJS's global prefix).",
      )
      .setVersion(process.env.npm_package_version ?? '0.0.1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addTag('auth', 'Registration and login')
      .addTag('users', "The authenticated user's own profile")
      .addTag('accounts', 'Wallet balances and transaction history')
      .addTag('deposits', 'Simulated funding of a wallet')
      .addTag('withdrawals', 'Maker-checker withdrawal requests')
      .addTag('admin/withdrawals', 'Admin review of pending withdrawals')
      .addTag('transfers', 'Internal user-to-user transfers')
      .addTag('fx', 'Live FX rates, quotes, and conversion')
      .addTag('orders', 'Simulated spot trading (market and limit orders)')
      .addTag('health', 'Liveness/readiness probe')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = config.get('PORT', { infer: true });

  await app.listen(port);
}

void bootstrap();
