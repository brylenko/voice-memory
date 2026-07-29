export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  /** Ask for a strict JSON object back (used by RAG's date-window NLU step). */
  responseFormatJson?: boolean;
}

/** Outbound port: synchronous chat completion, used for NLU parsing and grounded answers. */
export interface ChatCompletionPort {
  complete(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
}

export const CHAT_COMPLETION_PORT = Symbol('CHAT_COMPLETION_PORT');
