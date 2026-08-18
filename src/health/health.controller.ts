import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventLoopMonitorService } from './event-loop-monitor.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly eventLoop: EventLoopMonitorService,
  ) {}

  @Get()
  async check() {
    await this.db.query('SELECT 1');
    const snap = this.eventLoop.latest;
    return {
      status: 'ok',
      eventLoop: snap
        ? { p50: snap.p50, p95: snap.p95, p99: snap.p99, max: snap.max }
        : null,
    };
  }
}
