import { detectMemoryIntent } from './memory-intent';

describe('detectMemoryIntent', () => {
  it.each([
    ['Что я сегодня слышал?', 'today'],
    ['О чём мы сегодня говорили?', 'today'],
    ['Про що ми сьогодні домовились?', 'today'],
    ['О чём мы договорились с Олегом?', 'recall'],
    ['Что говорили вчера про бюджет?', 'recall'],
    ['Напомни, когда созвон', 'recall'],
    ['What did we agree on the release?', 'recall'],
  ])('%s → %s', (q, expected) => expect(detectMemoryIntent(q)).toBe(expected));

  it.each([
    'Назови паттерн на каждую букву SOLID',
    'Сколько стоит ирригатор?',
    'Что такое ACID?',
    'Расскажи про CAP-теорему',
    'Что вы обсуждали на прошлом проекте?',
    'Что говорит принцип подстановки Лисков?',
  ])('ordinary question is not a memory question: %s', (q) => expect(detectMemoryIntent(q)).toBe('none'));
});
