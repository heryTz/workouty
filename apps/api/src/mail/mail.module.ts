import { Global, Module } from '@nestjs/common'
import { NodemailerMailer } from './mailer'

export const MAILER = 'MAILER'
export type { Mailer, SendMailInput } from './mailer'

@Global()
@Module({
  providers: [{ provide: MAILER, useClass: NodemailerMailer }],
  exports: [MAILER],
})
export class MailModule {}
