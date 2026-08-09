import { OAuthStateStore } from './oauth-state.store';

describe('OAuthStateStore', () => {
  let store: OAuthStateStore;

  beforeEach(() => {
    store = new OAuthStateStore();
  });

  it('valid state is accepted and returns userId', () => {
    const token = store.generate('user-123');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(store.consume(token)).toBe('user-123');
  });

  it('invalid state is rejected', () => {
    expect(store.consume('not-a-real-token')).toBeNull();
  });

  it('same state used twice is rejected on second use', () => {
    const token = store.generate('user-123');
    expect(store.consume(token)).toBe('user-123');
    expect(store.consume(token)).toBeNull();
  });

  it('expired state is rejected', () => {
    const token = store.generate('user-123');
    // Manually expire by overwriting internal map entry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).states.set(token, { userId: 'user-123', expiresAt: Date.now() - 1 });
    expect(store.consume(token)).toBeNull();
  });

  it('different users get different tokens', () => {
    const t1 = store.generate('user-A');
    const t2 = store.generate('user-B');
    expect(t1).not.toBe(t2);
    expect(store.consume(t1)).toBe('user-A');
    expect(store.consume(t2)).toBe('user-B');
  });

  it('token is unpredictable (not userId-derived)', () => {
    const userId = 'user-123';
    const token = store.generate(userId);
    expect(token).not.toContain(userId);
    expect(token).not.toBe(userId);
  });
});
