import { AiAvailabilityService } from '../ai-availability';
import { OpenAiQuotaProbe } from './openai-quota-probe';

function setup(create: jest.Mock) {
  let t = 10 * 60_000;
  const availability = new AiAvailabilityService(60_000, () => t);
  const openai = { client: { chat: { completions: { create } } } };
  const probe = new OpenAiQuotaProbe(openai as never, availability, () => t);
  return { probe, availability, advance: (ms: number) => { t += ms; } };
}

describe('OpenAiQuotaProbe', () => {
  it('marks AI unavailable on insufficient_quota', async () => {
    const { probe, availability } = setup(jest.fn().mockRejectedValue({ status: 429, code: 'insufficient_quota' }));
    await probe.ensureFresh();
    expect(availability.isAvailable()).toBe(false);
  });

  it('probes at most once per interval and shares a concurrent probe', async () => {
    const create = jest.fn().mockResolvedValue({});
    const { probe, advance } = setup(create);
    await Promise.all([probe.ensureFresh(), probe.ensureFresh()]);
    await probe.ensureFresh();
    expect(create).toHaveBeenCalledTimes(1);
    advance(5 * 60_000);
    await probe.ensureFresh();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('ignores non-quota errors (network, rate limit)', async () => {
    const { probe, availability } = setup(jest.fn().mockRejectedValue({ status: 429, code: 'rate_limit_exceeded' }));
    await probe.ensureFresh();
    expect(availability.isAvailable()).toBe(true);
  });
});
