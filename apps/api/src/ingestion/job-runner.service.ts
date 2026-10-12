import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal in-process background queue (concurrency 1). Good enough for a
 * single-node demo; swap for BullMQ on the existing Redis when scaling out.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  get queueDepth(): number {
    return this.pending;
  }

  enqueue(name: string, task: () => Promise<void>): void {
    this.pending += 1;
    this.chain = this.chain.then(async () => {
      const startedAt = Date.now();
      try {
        await task();
        this.logger.log(`job ${name} finished in ${Date.now() - startedAt}ms`);
      } catch (error) {
        this.logger.error(`job ${name} failed: ${(error as Error).message}`, (error as Error).stack);
      } finally {
        this.pending -= 1;
      }
    });
  }
}
