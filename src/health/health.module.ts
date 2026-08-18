import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { EventLoopMonitorService } from './event-loop-monitor.service';

@Module({
  controllers: [HealthController],
  providers: [EventLoopMonitorService],
})
export class HealthModule {}
