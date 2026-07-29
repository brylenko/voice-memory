/**
 * Manual test for the WebSocket streaming transcription gateway.
 *
 * Usage:
 *   npx ts-node --esm src/scripts/test-streaming.ts <path-to-audio.ogg>
 *
 * What it does:
 *   1. Reads the audio file
 *   2. Connects to ws://localhost:3001/audio/live
 *   3. Sends audio in 100ms simulated chunks (mimics a live microphone)
 *   4. Prints transcript deltas as they arrive
 *   5. Prints the full transcript when done
 *
 * For PCM16 format required by OpenAI Realtime, pipe through ffmpeg first:
 *   ffmpeg -i input.ogg -ar 24000 -ac 1 -f s16le output.pcm
 * Then pass output.pcm to this script.
 */

import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: test-streaming.ts <path-to-audio.pcm>');
  process.exit(1);
}

const audioData = readFileSync(resolve(filePath));
const WS_URL = process.env.WS_URL ?? 'ws://localhost:3001/audio/live';
const CHUNK_SIZE = 4800; // 100ms of PCM16 24kHz mono (24000 samples/s × 2 bytes × 0.1s)
const CHUNK_INTERVAL_MS = 100;

console.log(`Connecting to ${WS_URL}`);
console.log(`File: ${filePath} (${audioData.length} bytes)`);
console.log(`Chunks: ${Math.ceil(audioData.length / CHUNK_SIZE)} × ${CHUNK_SIZE}B every ${CHUNK_INTERVAL_MS}ms\n`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✓ Connected. Streaming audio...\n');

  let offset = 0;
  const interval = setInterval(() => {
    const chunk = audioData.subarray(offset, offset + CHUNK_SIZE);
    if (chunk.length === 0) {
      clearInterval(interval);
      ws.send('end'); // signal stream end
      console.log('\n→ Sent "end" signal');
      return;
    }
    ws.send(chunk);
    offset += CHUNK_SIZE;
    process.stdout.write('.');
  }, CHUNK_INTERVAL_MS);
});

ws.on('message', (raw) => {
  const event = JSON.parse(raw.toString()) as { type: string; text?: string; fullText?: string; message?: string };

  if (event.type === 'transcript') {
    process.stdout.write(event.text ?? '');
  } else if (event.type === 'done') {
    console.log('\n\n─────────────────────────────────\n✓ Done');
    console.log('Full text:', event.fullText);
    ws.close();
  } else if (event.type === 'error') {
    console.error('\n✗ Error:', event.message);
    ws.close();
  }
});

ws.on('error', (err) => console.error('WS error:', err.message));
ws.on('close', () => { console.log('\nConnection closed.'); process.exit(0); });
