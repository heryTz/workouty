import { Controller, Get } from '@nestjs/common'

// A Dockerfile `ARG` declared without a matching `--build-arg` still sets the env var, to the
// empty string — so `?? 'dev'` alone would report a version of "".
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null
}

@Controller('version')
export class VersionController {
  @Get()
  version() {
    return {
      version: nonEmpty(process.env.APP_VERSION) ?? 'dev',
      releaseDate: nonEmpty(process.env.APP_RELEASE_DATE),
    }
  }
}
