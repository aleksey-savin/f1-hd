/** Coalesce refresh requests while the route, tab or editor cannot refresh. */
export const createDeferredRefresh = (run: () => Promise<boolean>) => {
  type Resolve = (ok: boolean) => void;
  let ready = false;
  let disposed = false;
  let running = false;
  let pending: Resolve[] = [];
  let active: Resolve[] = [];

  const flush = () => {
    if (!ready || disposed || running || !pending.length) return;
    running = true;
    active = pending;
    pending = [];
    try {
      void Promise.resolve(run()).then(
        ok => settle(ok !== false),
        () => settle(false),
      );
    } catch {
      settle(false);
    }
  };
  const settle = (ok: boolean) => {
    const completed = active;
    active = [];
    running = false;
    completed.forEach(resolve => resolve(!disposed && ok));
    flush();
  };
  return {
    request: (): Promise<boolean> => disposed ? Promise.resolve(false) : new Promise(resolve => {
      pending.push(resolve);
      flush();
    }),
    setReady: (value: boolean) => { ready = value; flush(); },
    dispose: () => {
      disposed = true;
      [...pending, ...active].forEach(resolve => resolve(false));
      pending = [];
      active = [];
    },
  };
};
