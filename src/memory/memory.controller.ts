import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceAuthGuard } from '../audio-ingest/adapters/inbound/http/device-auth.guard';
import { DeviceUserResolver } from '../user/device-user.resolver';
import { DayDigestService } from './day-digest.service';
import { DayQueryDto } from './dto/day-query.dto';
import { AiAvailabilityService } from '../ai/ai-availability';
import { OpenAiQuotaProbe } from '../ai/adapters/openai-quota-probe';

@Controller('api/memory')
export class MemoryController {
  constructor(
    private readonly days: DayDigestService,
    private readonly users: DeviceUserResolver,
    private readonly ai: AiAvailabilityService,
    private readonly quotaProbe: OpenAiQuotaProbe,
  ) {}

  /** GET /api/memory/status — lets the watch pause streaming/uploads while AI is unavailable. */
  @Get('status')
  @UseGuards(DeviceAuthGuard)
  async status() {
    await this.quotaProbe.ensureFresh();
    return { ai: this.ai.status() };
  }

  /** GET /api/memory/day?date=2026-11-05&tzOffsetMinutes=120 */
  @Get('day')
  @UseGuards(DeviceAuthGuard)
  async day(@Query() query: DayQueryDto, @Req() req: Request & { deviceSerial: string }) {
    const { id: userId } = await this.users.resolve(req.deviceSerial);
    return this.days.getDay(userId, query);
  }
}
