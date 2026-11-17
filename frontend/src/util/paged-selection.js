export async function fetchSelectionPages(fetchPage, signal) {
  const records = new Map();
  for (let page = 1; ; page += 1) {
    signal?.throwIfAborted();
    const result = await fetchPage(page, signal);
    signal?.throwIfAborted();
    const before = records.size;
    for (const item of result.items)
      records.set(String(item._id ?? item.id), item);
    if (records.size >= result.total) return [...records.values()];
    if (records.size === before) {
      throw new Error(
        "Список изменился во время выбора. Повторите выбор всех записей",
      );
    }
  }
}
