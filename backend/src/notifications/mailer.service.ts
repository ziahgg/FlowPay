import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { EnvConfig } from '../common/config/env.schema';

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

/**
 * Thin wrapper around nodemailer's SMTP transport, pointed at Mailhog in dev (see docker-compose.yml)
 * -- no real email is ever sent. `secure: false` + `ignoreTLS: true` because Mailhog's dev SMTP
 * listener doesn't speak TLS.
 */
@Injectable()
export class MailerService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.transporter = nodemailer.createTransport({
      host: configService.get('SMTP_HOST', { infer: true }),
      port: configService.get('SMTP_PORT', { infer: true }),
      secure: false,
      ignoreTLS: true,
    });
    this.from = configService.get('MAIL_FROM', { infer: true });
  }

  async send(params: SendEmailParams): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
  }
}
