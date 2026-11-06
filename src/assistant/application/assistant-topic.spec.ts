import { buildAssistantMessages } from './assistant-prompt';
import { parseTopic, topicTranscriptionHint } from './assistant-topic';

const u = (text: string) => ({ id: '1', text, at: new Date('2026-11-06T10:00:00Z') });

describe('assistant topics', () => {
  it('parses known topics and falls back to none for anything else', () => {
    expect(parseTopic('interview_it')).toBe('interview_it');
    expect(parseTopic('rm -rf')).toBe('none');
    expect(parseTopic(null)).toBe('none');
  });

  it('interview topic tells the model it hears interviewer questions with standard meanings', () => {
    const [system] = buildAssistantMessages({
      conversation: [u('назови паттерн на каждую букву SOLID')], memory: [], forced: false, topic: 'interview_it',
    });
    expect(system.content).toContain('job interview');
    expect(system.content).toContain('embody each');
    expect(topicTranscriptionHint('interview_it')).toContain('design patterns');
  });

  it('no topic adds no context rules', () => {
    const [system] = buildAssistantMessages({ conversation: [u('x')], memory: [], forced: false });
    expect(system.content).not.toContain('CONTEXT:');
    expect(topicTranscriptionHint('none')).toBeUndefined();
  });
});
