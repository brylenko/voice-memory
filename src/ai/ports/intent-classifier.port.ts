export enum RecordingType {
  Meeting   = 'meeting',
  Interview = 'interview',
  Lecture   = 'lecture',
  SalesCall = 'sales_call',
  Custom    = 'custom',
}

export type AudioIntent =
  | { kind: 'recording'; recordingType: RecordingType }
  | { kind: 'search_query' }
  | { kind: 'mark_task_done'; taskHint: string }
  | { kind: 'list_tasks' };

export interface IntentClassifierPort {
  classify(transcribedText: string): Promise<AudioIntent>;
}

export const INTENT_CLASSIFIER_PORT = Symbol('INTENT_CLASSIFIER_PORT');
