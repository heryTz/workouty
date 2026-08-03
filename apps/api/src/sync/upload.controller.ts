import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { JwtAuthGuard, type RequestWithUserId } from '../auth/jwt-auth.guard'
import { uploadBatchSchema, type UploadBatch } from './upload-contracts'
import { UploadService, type ApplyResult } from './upload.service'

@Controller('sync')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // Per PowerSync's upload contract, a validation/ownership rejection is reported as a 2xx
  // body ({ rejected }), never a 4xx/5xx — only genuine auth failure (guard) or infra
  // failure (thrown from the service) should produce an error status.
  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @HttpCode(200)
  async upload(
    @Req() request: RequestWithUserId,
    @Body(new ZodValidationPipe(uploadBatchSchema)) body: UploadBatch,
  ): Promise<ApplyResult> {
    return this.uploadService.apply(request.userId, body.batch)
  }
}
