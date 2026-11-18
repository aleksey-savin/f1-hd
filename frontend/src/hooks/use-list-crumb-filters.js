import { useLayoutEffect } from "react";
import { useLocation } from "react-router";
import { usePageCrumbs } from "@/components/app/crumb-context";
import {
  captureListFilters,
  companyListFilters,
  restoreListFilters,
} from "@/util/list-crumb-filters";

/** Store-backed lists keep a filter-only snapshot on their history entry.
 * A fresh company link resets the scope; POP/reload/source return restores it. */
export default function useListCrumbFilters(path, store) {
  const location = useLocation();
  const state = store();
  const atList = location.pathname.replace(/\/$/, "") === path;
  const snapshot = captureListFilters(path, state);
  usePageCrumbs(atList ? { listSnapshot: snapshot } : {});

  useLayoutEffect(() => {
    if (!atList) return;
    const initial = store.getInitialState();
    const incoming = restoreListFilters(
      path,
      location.state?.listSnapshot,
      initial,
    );
    const company = new URLSearchParams(location.search).get("companyScope");
    const patch =
      incoming ??
      (company ? companyListFilters(path, initial, company) : undefined);
    if (patch) {
      const restore = store.getState().restoreNavigationFilters;
      if (restore) restore(patch);
      else store.setState(patch);
      store.getState().applyFilter?.();
    }
    // Preserve React Router's key/index and all unrelated navigation state.
    // Subscribe synchronously so even a click immediately after filtering
    // leaves the source history entry with the latest choice.
    const persist = () => {
      const history = window.history.state;
      window.history.replaceState(
        {
          ...history,
          usr: {
            ...history?.usr,
            listSnapshot: captureListFilters(path, store.getState()),
          },
        },
        "",
      );
    };
    persist();
    return store.subscribe(persist);
  }, [path, store, atList, location.key]);
}
