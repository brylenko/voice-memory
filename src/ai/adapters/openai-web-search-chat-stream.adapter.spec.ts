import { AiAvailabilityService, AiUnavailableError } from '../ai-availability';
import { OpenAiWebSearchChatStreamAdapter } from './openai-web-search-chat-stream.adapter';

async function* events(list: unknown[]) { yield* list; }
async function collect(it: AsyncIterable<string>) { let s = ''; for await (const t of it) s += t; return s; }

function setup(create: jest.Mock, country?: string) {
  const availability = new AiAvailabilityService();
  const client = { responses: { create } };
  const adapter = new OpenAiWebSearchChatStreamAdapter(client as never, availability, {
    model: 'gpt-4o-mini', toolType: 'web_search', country,
  });
  return { adapter, availability };
}

describe('OpenAiWebSearchChatStreamAdapter', () => {
  it('streams only the answer text and sends the web search tool with location', async () => {
    const create = jest.fn().mockResolvedValue(events([
      { type: 'response.web_search_call.searching' },
      { type: 'response.output_text.delta', delta: '1500–3000 грн' },
      { type: 'response.output_text.delta', delta: ' (Rozetka).' },
      { type: 'response.completed' },
    ]));
    const { adapter } = setup(create, 'UA');

    await expect(collect(adapter.stream([{ role: 'user', content: 'цена ирригатора' }]))).resolves.toBe('1500–3000 грн (Rozetka).');
    const body = create.mock.calls[0][0];
    expect(body.tools[0]).toMatchObject({ type: 'web_search', user_location: { country: 'UA' } });
    expect(body.stream).toBe(true);
  });

  it('maps a quota failure to AiUnavailableError and flips availability', async () => {
    const create = jest.fn().mockRejectedValue({ status: 429, code: 'insufficient_quota' });
    const { adapter, availability } = setup(create);

    await expect(collect(adapter.stream([{ role: 'user', content: 'x' }]))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(availability.isAvailable()).toBe(false);
  });

  it('surfaces a failed response as an error', async () => {
    const create = jest.fn().mockResolvedValue(events([
      { type: 'response.failed', response: { error: { code: 'server_error' } } },
    ]));
    const { adapter } = setup(create);
    await expect(collect(adapter.stream([{ role: 'user', content: 'x' }]))).rejects.toThrow('server_error');
  });
});
