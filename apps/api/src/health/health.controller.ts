import { Controller, Get } from '@nestjs/common'
import { estimateOneRepMax } from '@workouty/shared'

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', oneRepMaxProbe: estimateOneRepMax(60, 8) }
  }
}
