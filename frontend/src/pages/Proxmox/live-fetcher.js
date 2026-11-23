/** Bridge router completion to the React commit carrying its loader result. */
export function createFetcherRefresh(requestCommit) {
  let pending = null;
  const finish = (success) => {
    const current = pending;
    pending = null;
    current?.resolve(success);
  };
  return {
    run(load, previousData) {
      if (pending) return pending.promise;
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      const current = { promise, resolve, loaded: false, previousData };
      pending = current;
      Promise.resolve()
        .then(load)
        .then(
          () => {
            if (pending !== current) return;
            current.loaded = true;
            requestCommit();
          },
          () => {
            if (pending === current) finish(false);
          },
        );
      return promise;
    },
    commit(data) {
      if (pending?.loaded && data !== pending.previousData)
        finish(Boolean(data && !data.error));
    },
    dispose() {
      finish(false);
    },
  };
}
