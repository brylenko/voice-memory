/**
 * Outbound port for the processing side: given whatever `storageKey`
 * AudioStoragePort handed back at ingest time, fetch the raw bytes back.
 * Kept separate from (but symmetrical with) AudioStoragePort in
 * audio-ingest/ so the worker doesn't need to depend on the ingest module —
 * it only needs to agree on what a storageKey means for a given driver.
 */
export interface AudioRetrievalPort {
  getBuffer(storageKey: string): Promise<Buffer>;
}

export const AUDIO_RETRIEVAL_PORT = Symbol('AUDIO_RETRIEVAL_PORT');
