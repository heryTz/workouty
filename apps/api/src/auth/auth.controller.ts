import { Body, Controller, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  resetRequestSchema,
  resetSchema,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
  type ResetDto,
  type ResetRequestDto,
} from './auth-contracts'
import { AuthService, type TokenPair } from './auth.service'

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
  async register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto): Promise<TokenPair> {
    const user = await this.authService.register(dto.email, dto.password)
    return this.authService.issueTokens(user.id)
  }

  // Tighter than the app-wide default: blunts credential-stuffing against this one route.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto): Promise<TokenPair> {
    const user = await this.authService.validate(dto.email, dto.password)
    if (!user) throw new UnauthorizedException('Invalid credentials')
    return this.authService.issueTokens(user.id)
  }

  // Same rate limit rationale as login: bounds brute-force guessing of refresh secrets.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto): Promise<TokenPair> {
    return this.authService.rotateRefresh(dto.refreshToken)
  }

  // Tight, like login: bounds abuse of this endpoint as a mail-bombing or enumeration
  // oracle. Always 202 regardless of whether `dto.email` is registered — and NOT awaited:
  // the known-email path does a DB lookup + insert + email render + SMTP send, while the
  // unknown-email path does nothing. Awaiting either one would make the response latency
  // itself an oracle (a known email measurably slower than an unknown one), which is just
  // as much an enumeration leak as a different status code or body. Firing requestReset
  // in the background and returning 202 immediately makes the two paths equally fast from
  // the caller's perspective. Failures are logged, never surfaced — the caller can't tell
  // the difference between "email sent" and "email failed to send" either.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-request')
  @HttpCode(202)
  resetRequest(@Body(new ZodValidationPipe(resetRequestSchema)) dto: ResetRequestDto): void {
    void this.authService.requestReset(dto.email).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`reset-request background failure: ${message}`)
    })
  }

  // Same generic-rejection rationale as /auth/refresh: malformed, unknown, expired, used,
  // and wrong-secret tokens are all indistinguishable from the outside.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset')
  @HttpCode(200)
  async reset(@Body(new ZodValidationPipe(resetSchema)) dto: ResetDto): Promise<void> {
    await this.authService.performReset(dto.token, dto.password)
  }
}
