/**
 * Conversation context presets ("topic"). The same words mean different things in
 * different settings — "a pattern for each letter of SOLID" is a standard interview
 * question about which design patterns embody each principle, not a letter puzzle.
 * The topic tells the model how to read what it hears and how to answer.
 */
export type AssistantTopicId = 'none' | 'interview_it' | 'work_it' | 'study' | 'medicine' | 'shopping';

interface TopicPreset {
  /** Extra system rules for the answer model. */
  rules: string[];
  /** Vocabulary hint appended to the speech-recognition prompt. */
  transcriptionHint: string;
}

const PRESETS: Record<Exclude<AssistantTopicId, 'none'>, TopicPreset> = {
  interview_it: {
    rules: [
      'CONTEXT: the user is a CANDIDATE in a technical software-engineering job interview.',
      'Most utterances are the INTERVIEWER\'s questions. Read each one the way interviewers mean it — standard interview',
      'questions have standard meanings (e.g. "назови паттерн на каждую букву SOLID" = which design patterns embody each',
      'SOLID principle; "расскажи про CAP" = the theorem and its trade-offs).',
      'Every technical question deserves an answer — never skip one. Answer as talking points the candidate can say',
      'right away: key terms first, then a short justification or example; one line per point.',
    ],
    transcriptionHint:
      'Technical job interview: software architecture, design patterns, SOLID, GRASP, GoF, OOP, databases, ACID, CAP, ' +
      'Kubernetes, Docker, microservices, Node.js, TypeScript, Java, Kotlin, Python, SQL, REST, gRPC, Kafka.',
  },
  work_it: {
    rules: [
      'CONTEXT: a work meeting in a software team. Interpret jargon as engineers mean it; prefer precise technical answers.',
    ],
    transcriptionHint: 'Software team meeting: deployment, release, backlog, sprint, pull request, API, database, cloud.',
  },
  study: {
    rules: ['CONTEXT: a lecture or study session. Explain clearly with one example; definitions and formulas welcome.'],
    transcriptionHint: 'Lecture or study session.',
  },
  medicine: {
    rules: [
      'CONTEXT: a medical conversation. Use correct medical terms; general information only — never a diagnosis;',
      'suggest consulting a doctor when it matters.',
    ],
    transcriptionHint: 'Medical conversation: symptoms, diagnosis, medications, dosage.',
  },
  shopping: {
    rules: ['CONTEXT: shopping. Prefer concrete prices, models, comparisons and where to buy (search the web).'],
    transcriptionHint: 'Shopping: prices, models, brands, stores.',
  },
};

export const TOPIC_IDS = ['none', ...Object.keys(PRESETS)] as AssistantTopicId[];

export function parseTopic(raw: string | null | undefined): AssistantTopicId {
  return (TOPIC_IDS as string[]).includes(raw ?? '') ? (raw as AssistantTopicId) : 'none';
}

export function topicRules(topic: AssistantTopicId): string[] {
  return topic === 'none' ? [] : PRESETS[topic].rules;
}

export function topicTranscriptionHint(topic: AssistantTopicId): string | undefined {
  return topic === 'none' ? undefined : PRESETS[topic].transcriptionHint;
}
