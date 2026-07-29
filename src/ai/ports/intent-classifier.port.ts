export type RecordingType = 'meeting' | 'interview' | 'lecture' | 'sales_call' | 'custom';
export type AudioIntent =
  | { kind: 'recording'; recordingType: RecordingType }
  | { kind: 'search_query' }
  | { kind: 'mark_task_done'; taskHint: string }
  | { kind: 'list_tasks' };

/**
 * Outbound port: classify a voice message as a search query or a recording,
 * and if recording — detect the recording type for template selection.
 */
export interface IntentClassifierPort {
  classify(transcribedText: string): Promise<AudioIntent>;
}

export const INTENT_CLASSIFIER_PORT = Symbol('INTENT_CLASSIFIER_PORT');
