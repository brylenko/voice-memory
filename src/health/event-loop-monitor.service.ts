import { Injectable } from '@nestjs/common';
import { LoopSnapshot } from 'loopwarden';
import { createLoopwardenService, OverloadState } from 'loopwarden/nestjs';
import { getHeapStatistics, getHeapSpaceStatistics } from 'v8';

export const overloadState = new OverloadState();

function mb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

@Injectable()
export class EventLoopMonitorService {
  latest: LoopSnapshot | null = null;

  private readonly service = createLoopwardenService({
    intervalMs: 1_000,
    metric: 'p99',
    warn: { ms: 30, debounceMs: 10_000 },
    critical: { ms: 60, debounceMs: 30_000 },
    captureStackOnThreshold: true,
    onLog: (snap) => {
      this.latest = snap;
      console.log(`[loopwarden] p50=${snap.p50}ms p95=${snap.p95}ms p99=${snap.p99}ms max=${snap.max}ms${snap.traceIds?.length ? ` traceIds=${snap.traceIds.join(',')}` : ''}`);
    },
    onThreshold: (snap, level) => {
      if (level === 'critical') overloadState.setOverloaded(true);
      const heap = getHeapStatistics();
      const spaces = getHeapSpaceStatistics();
      const oldSpace = spaces.find(s => s.space_name === 'old_space');
      console.warn([
        `[loopwarden] ${level}: p99=${snap.p99}ms max=${snap.max}ms`,
        snap.traceIds?.length ? `traceIds=${snap.traceIds.join(',')}` : null,
        `heap=${mb(heap.used_heap_size)}/${mb(heap.heap_size_limit)}MB`,
        `rss=${mb(snap.memory?.rss ?? 0)}MB`,
        oldSpace ? `oldSpace=${mb(oldSpace.space_used_size)}MB` : null,
        `handles=${(process as any)._getActiveHandles().length}`,
        `requests=${(process as any)._getActiveRequests().length}`,
        snap.stack ? `\n${snap.stack}` : null,
      ].filter(Boolean).join(' '));
    },
    onRecover: (_, level) => {
      overloadState.setOverloaded(false);
      console.log(`[loopwarden] recovered from ${level}`);
    },
  });

  onModuleInit() {
    this.service.onModuleInit();
  }

  onModuleDestroy() {
    this.service.onModuleDestroy();
  }
}
