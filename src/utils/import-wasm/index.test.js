const { _getNPages: getNPages, _PAGE_SIZE: PAGE_SIZE } = require('.');

describe('private getNPages()', () => {
  it('should be 0', () => {
    expect(getNPages(0)).toBe(0);
  });

  it('should be 1', () => {
    for (let i = 1; i <= PAGE_SIZE; i++) {
      expect(getNPages(i)).toBe(1);
    }
  });

  it('should be 2', () => {
    for (let i = PAGE_SIZE + 1; i <= 2 * PAGE_SIZE; i++) {
      expect(getNPages(i)).toBe(2);
    }
  });

  it('should be 4', () => {
    expect(getNPages(3 * PAGE_SIZE + 100)).toBe(4);
  });
});
