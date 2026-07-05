import type { SearchParams } from './filters';

export const DEFAULT_PAGE_SIZE = 20;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
}

/** Parse `page` and `q` query params into pagination inputs for Prisma. */
export function parsePagination(
  sp: SearchParams,
  pageSize: number = DEFAULT_PAGE_SIZE
): PageParams {
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const q = (one(sp.q) ?? '').trim();
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, q };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  q: string;
}

export function buildPageMeta(params: PageParams, total: number): PageMeta {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    q: params.q,
  };
}

/**
 * Build a case-insensitive Prisma OR filter across the given string fields.
 * Returns undefined when the query is empty so callers can spread it safely.
 * Supports one level of relation nesting, e.g. 'product.name'.
 */
export function searchFilter(
  q: string,
  fields: string[]
): { OR: Record<string, unknown>[] } | undefined {
  if (!q) return undefined;
  const OR = fields.map((field) => {
    const match = { contains: q, mode: 'insensitive' as const };
    if (field.includes('.')) {
      const [rel, col] = field.split('.');
      return { [rel]: { [col]: match } };
    }
    return { [field]: match };
  });
  return { OR };
}
