import type { ChatCompletionOptions, ChatMessage } from './chat-completion.port';

/**
 * Outbound port: token-streaming chat completion. Kept separate from
 * ChatCompletionPort (ISP) — most callers only need the blocking variant.
 */
export interface ChatStreamPort {
  stream(messages: ChatMessage[], options?: ChatCompletionOptions): AsyncIterable<string>;
}

export const CHAT_STREAM_PORT = Symbol('CHAT_STREAM_PORT');
