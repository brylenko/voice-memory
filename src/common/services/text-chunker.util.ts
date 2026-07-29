/**
 * Splits a transcript into semantically coherent chunks of ~targetSize characters,
 * always breaking on sentence boundaries so embeddings stay meaningful.
 */
export function chunkTextBySentence(text: string, targetSize = 800): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [text];

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > targetSize && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export function dayOfWeekOf(date: Date): (typeof DAY_NAMES)[number] {
  return DAY_NAMES[date.getDay()];
}
