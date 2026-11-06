import { EchoGuard } from './echo-guard';

describe('EchoGuard', () => {
  it('flags the assistant hearing its own answer (with recognition noise)', () => {
    const g = new EchoGuard();
    g.rememberAnswer('Ирригатор стоит от 1500 до 3000 гривен в Розетке.');
    expect(g.isEcho('ирригатор стоит от 1500 до 3000 гривен в розетке')).toBe(true);
    expect(g.isEcho('Ирригатор стоит от 1500 до 3000 гривен')).toBe(true);
  });

  it('does not flag a genuinely new question on the same topic', () => {
    const g = new EchoGuard();
    g.rememberAnswer('Ирригатор стоит от 1500 до 3000 гривен в Розетке.');
    expect(g.isEcho('А какой ирригатор лучше для брекетов?')).toBe(false);
  });

  it('forgets answers outside the time window', () => {
    let t = 0;
    const g = new EchoGuard(30_000, 0.6, () => t);
    g.rememberAnswer('Domino’s — международная сеть пиццерий из США.');
    t = 31_000;
    expect(g.isEcho('международная сеть пиццерий из США')).toBe(false);
  });

  it('treats a distinctive single word from a recent answer as echo, but not short words', () => {
    const g = new EchoGuard();
    g.rememberAnswer('4. I — Iterator: последовательный обход. Итератор скрывает устройство коллекции.');
    expect(g.isEcho('итератор')).toBe(true);
    expect(g.isEcho('что')).toBe(false);
    expect(g.isEcho('декоратор')).toBe(false); // not in the answer → a real new question
  });
});
