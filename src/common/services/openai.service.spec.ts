import { OpenAiService } from './openai.service';
import { ConfigService } from '@nestjs/config';

function makeService(apiKey = 'test-key') {
  const config = { get: jest.fn().mockReturnValue(apiKey) } as unknown as ConfigService;
  return new OpenAiService(config);
}

describe('OpenAiService', () => {
  it('creates client with maxRetries=0 to let BullMQ own retry logic', () => {
    const svc = makeService();
    // OpenAI SDK exposes maxRetries on the client instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((svc.client as any)._options?.maxRetries).toBe(0);
  });

  it('creates client with 120s timeout', () => {
    const svc = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((svc.client as any)._options?.timeout).toBe(120_000);
  });
});
