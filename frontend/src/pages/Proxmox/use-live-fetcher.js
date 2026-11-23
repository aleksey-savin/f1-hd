import { useCallback, useEffect, useRef, useState } from "react";
import { useFetchers, useRevalidator } from "react-router";
import useLiveTopic from "@/hooks/use-live-topic";
import { createFetcherRefresh } from "./live-fetcher";

/** Silent refreshes retain the last result and acknowledge committed loader data. */
export default function useLiveFetcher(reader, path, options = {}) {
  const [, requestCommit] = useState(0);
  const [refresh] = useState(() =>
    createFetcherRefresh(() => requestCommit((value) => value + 1)),
  );
  const background = useRef(false);
  const previous = useRef(null);
  if (reader.data && !reader.data.error) previous.current = reader.data;
  const fetchers = useFetchers();
  const revalidator = useRevalidator();
  const idle =
    reader.state === "idle" &&
    revalidator.state === "idle" &&
    fetchers.every((fetcher) => fetcher.state === "idle");
  useEffect(() => {
    if (reader.state === "idle") refresh.commit(reader.data);
  });
  useEffect(() => () => refresh.dispose(), [refresh]);
  useLiveTopic(
    "proxmox",
    () => {
      background.current = true;
      return refresh.run(() => reader.load(path), reader.data);
    },
    {
      ...options,
      baseline: reader.data?.error ? null : reader.data?.pulse,
      enabled: options.enabled !== false && idle,
    },
  );
  const { load } = reader;
  const explicitLoad = useCallback(
    (url) => {
      background.current = false;
      return load(url);
    },
    [load],
  );
  return {
    data:
      background.current && reader.data?.error ? previous.current : reader.data,
    load: explicitLoad,
  };
}
