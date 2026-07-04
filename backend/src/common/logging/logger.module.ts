import { IncomingMessage } from 'http';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { EnvConfig } from '../config/env.schema';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        const isDev = nodeEnv === 'development';

        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            genReqId: (req: IncomingMessage) => req.headers[REQUEST_ID_HEADER] as string,
            customProps: (req: IncomingMessage) => ({ requestId: req.headers[REQUEST_ID_HEADER] }),
            transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
            autoLogging: nodeEnv !== 'test',
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
