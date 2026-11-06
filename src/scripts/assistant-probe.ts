/**
 * Ask the live assistant a question directly — no watch, no microphone — to compare
 * models / topics / web search in seconds. Uses exactly the production prompt.
 *
 * Usage (inside the app container):
 *   node dist/scripts/assistant-probe.js "назови паттерн на каждую букву SOLID" \
 *        [--topic interview_it] [--model gpt-4o] [--no-search] [--forced] [--show-prompt]
 */
import 'reflect-metadata';
import OpenAI from 'openai';
import { buildAssistantMessages } from '../assistant/application/assistant-prompt';
import { parseTopic } from '../assistant/application/assistant-topic';
import { toPlainText } from '../assistant/application/plain-text';
import { AiAvailabilityService } from '../ai/ai-availability';
import { OpenAiWebSearchChatStreamAdapter } from '../ai/adapters/openai-web-search-chat-stream.adapter';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const question = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--topic') && !args[i - 1]?.startsWith('--model'));
  if (!question) {
    console.error('Usage: assistant-probe.js "<question>" [--topic interview_it] [--model gpt-4o] [--no-search] [--forced] [--show-prompt]');
    process.exit(1);
  }

  const topic = parseTopic(opt('topic') ?? 'none');
  const model = opt('model') ?? process.env.ASSISTANT_MODEL ?? 'gpt-4o-mini';
  const search = !flag('no-search');
  const messages = buildAssistantMessages({
    conversation: [{ id: '1', text: question, at: new Date() }],
    memory: [],
    forced: flag('forced'),
    topic,
  });
  if (flag('show-prompt')) console.log(`--- instructions ---\n${messages[0].content}\n--------------------`);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`model=${model} topic=${topic} search=${search} forced=${flag('forced')}\n`);
  const t0 = Date.now();
  let text = '';
  if (search) {
    const adapter = new OpenAiWebSearchChatStreamAdapter(client, new AiAvailabilityService(), {
      model,
      toolType: process.env.ASSISTANT_WEB_SEARCH_TOOL ?? 'web_search',
      country: process.env.ASSISTANT_SEARCH_COUNTRY || undefined,
    });
    for await (const d of adapter.stream(messages, { temperature: 0.3 })) text += d;
  } else {
    const res = await client.chat.completions.create({ model, messages, temperature: 0.3 });
    text = res.choices[0]?.message?.content ?? '';
  }
  console.log(toPlainText(text));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
