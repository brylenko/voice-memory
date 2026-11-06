/**
 * Watch screens and TTS need plain text, but models often emit Markdown anyway
 * (`**bold**`, headings, backticks) despite being told not to. Strip it.
 */
export function toPlainText(text: string): string {
  return text
    .replace(/\*\*|__/g, '')          // bold
    .replace(/`+/g, '')               // code
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/\n{3,}/g, '\n\n')       // blank-line runs
    .trim();
}

/** Same, for a streamed delta: only removes markers fully inside the chunk. */
export function stripDeltaMarkup(delta: string): string {
  return delta.replace(/\*\*|__|`+/g, '');
}
