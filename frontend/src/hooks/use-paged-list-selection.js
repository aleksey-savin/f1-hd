import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useListSelection from "./use-list-selection";
import { fetchSelectionPages } from "@/util/paged-selection";

// Страницы не являются фильтром: выбор сохраняется между ними. Полный набор
// читается только по явному «Выбрать все», с отменой устаревшего запроса.
export default function usePagedListSelection({
  items,
  total,
  queryKey,
  enabled,
  fetchPage,
}) {
  const [snapshot, setSnapshot] = useState({ key: queryKey, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(null);
  const records = useMemo(() => {
    const map = new Map(
      (snapshot.key === queryKey ? snapshot.items : []).map((item) => [
        String(item._id ?? item.id),
        item,
      ]),
    );
    for (const item of items) {
      const id = String(item._id ?? item.id);
      if (!map.has(id)) map.set(id, item);
    }
    return [...map.values()].map((item) => ({
      ...item,
      _id: String(item._id ?? item.id),
    }));
  }, [snapshot, items, queryKey]);
  const cancelPending = useCallback(() => {
    request.current?.abort();
    setLoading(false);
  }, []);
  const selection = useListSelection({
    items: records,
    rangeItems: items,
    enabled,
    onExit: cancelPending,
  });
  const exitBase = selection.exit;
  useEffect(() => {
    exitBase();
    setSnapshot({ key: queryKey, items: [] });
    setLoading(false);
    setError(null);
    return () => request.current?.abort();
  }, [queryKey, exitBase]);
  // Кэшируем страницы только во время выбора; не дублируем весь обычный список.
  useEffect(() => {
    if (selection.isActive) {
      setSnapshot((previous) => {
        const map = new Map(
          (previous.key === queryKey ? previous.items : []).map((item) => [
            String(item._id ?? item.id),
            item,
          ]),
        );
        let changed = previous.key !== queryKey;
        for (const item of items) {
          const id = String(item._id ?? item.id);
          if (map.get(id) !== item) {
            map.set(id, item);
            changed = true;
          }
        }
        return changed ? { key: queryKey, items: [...map.values()] } : previous;
      });
    }
  }, [items, queryKey, selection.isActive]);
  const selectAll = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const all = await fetchSelectionPages(fetchPage, controller.signal);
      controller.signal.throwIfAborted();
      setSnapshot({ key: queryKey, items: all });
      selection.selectIds(all.map((item) => item._id ?? item.id));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (request.current === controller) setLoading(false);
    }
  };
  const selectedItems = records.filter((item) =>
    selection.isSelected(item._id),
  );
  return {
    ...selection,
    selectedItems,
    total,
    loading,
    error,
    selectAll,
    toggle: (...args) => {
      cancelPending();
      selection.toggle(...args);
    },
    clearSelection: () => {
      cancelPending();
      selection.clearSelection();
    },
    allSelected: total > 0 && selection.count === total,
    someSelected: selection.count > 0 && selection.count < total,
    exit: () => {
      request.current?.abort();
      setLoading(false);
      exitBase();
    },
  };
}
