const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * PostgREST/Supabase silently caps selects around 1000 rows.
 * Use this whenever you need every matching row for aggregation or filtering.
 * The first page is read alone (most tables fit in it); after that pages are read
 * `concurrency` at a time, which may ask for up to concurrency-1 empty pages at the end.
 */
export async function fetchAllByRange<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = SUPABASE_PAGE_SIZE,
  concurrency = 4,
): Promise<T[]> {
  const readPage = async (index: number): Promise<T[]> => {
    const from = index * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const rows = await readPage(0);
  if (rows.length < pageSize) return rows;

  for (let next = 1; ; next += concurrency) {
    const batches = await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, (_, i) => readPage(next + i)),
    );
    for (const batch of batches) {
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }
}
