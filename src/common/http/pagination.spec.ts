import { buildPaginationMeta } from './pagination.js';

describe('buildPaginationMeta', () => {
  it('derives total pages and navigation flags', () => {
    expect(buildPaginationMeta(1, 25, 42)).toEqual({
      page: 1,
      limit: 25,
      total: 42,
      totalPages: 2,
      hasNext: true,
      hasPrevious: false,
    });

    expect(buildPaginationMeta(2, 25, 42)).toEqual({
      page: 2,
      limit: 25,
      total: 42,
      totalPages: 2,
      hasNext: false,
      hasPrevious: true,
    });
  });

  it('reports zero pages for an empty result', () => {
    expect(buildPaginationMeta(1, 25, 0)).toEqual({
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    });
  });
});
