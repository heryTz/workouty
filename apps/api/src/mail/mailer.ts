import { Injectable } from '@nestjs/common'
import { createTransport, type Transporter } from 'nodemailer'

export interface SendMailInput {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * The seam between "we need to send transactional email" and whatever actually delivers
 * it. Today that's Nodemailer talking SMTP to Mailpit in dev (and to a real SMTP relay in
 * production, via `SMTP_URL`). A future production provider (SES, Postmark, etc.) can
 * replace the implementation behind this same `send()` interface without touching callers.
 */
export interface Mailer {
  send(input: SendMailInput): Promise<void>
}

@Injectable()
export class NodemailerMailer implements Mailer {
  private readonly transporter: Transporter

  constructor() {
    const smtpUrl = process.env.SMTP_URL
    if (!smtpUrl) throw new Error('SMTP_URL is required to send mail')
    this.transporter = createTransport(smtpUrl)
  }

  async send({ to, subject, html, text }: SendMailInput): Promise<void> {
    await this.transporter.sendMail({
      from: 'Workouty <no-reply@workouty.local>',
      to,
      subject,
      html,
      text,
    })
  }
}
