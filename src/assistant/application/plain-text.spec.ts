import { stripDeltaMarkup, toPlainText } from './plain-text';

describe('toPlainText', () => {
  it('removes bold, code and headings but keeps lists and line breaks', () => {
    const md = '## SOLID\n\n\n1. **S - Single Responsibility**:\n   - **Facade** — `код`';
    expect(toPlainText(md)).toBe('SOLID\n\n1. S - Single Responsibility:\n   - Facade — код');
  });

  it('strips markers inside streamed deltas', () => {
    expect(stripDeltaMarkup('**Facade**')).toBe('Facade');
  });
});
