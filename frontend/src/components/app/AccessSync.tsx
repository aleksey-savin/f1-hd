import { useNavigate } from "react-router";
import { useEffect, useRef } from "react";

import { accessChanged } from "@/lib/access-refresh";
import { useAuthedUser } from "@/store/authed-user";
import usePulseStore from "@/store/pulse";
import useRouteErrorStore from "@/store/route-error";
import { refreshAuthData } from "@/util/auth";
import { useDeferredRevalidate } from "./use-refresh-route";

type Identity = NonNullable<Exclude<Awaited<ReturnType<typeof refreshAuthData>>, Response>>;

// Refresh only identity: child loader updates can erase an unsaved form/dialog.
// An existing loader error has no editor to preserve and needs revalidation.
const AccessSync = ({ onRefresh }: { onRefresh: (identity: Identity) => void }) => {
  const user = useAuthedUser();
  const access = usePulseStore((state) => state.access);
  const revalidate = useDeferredRevalidate();
  const routeError = useRouteErrorStore((state) => state.active);
  const navigate = useNavigate();
  const pending = useRef(false);

  useEffect(() => {
    if (pending.current || !accessChanged(user, access)) return;
    pending.current = true;
    void refreshAuthData()
      .then((identity) => {
        if (!identity) return;
        if (identity instanceof Response) {
          navigate(identity.headers.get("Location") || "/auth");
          return;
        }
        if (identity.userData._id !== user._id) return;
        onRefresh(identity);
        if (routeError) return revalidate();
      })
      // A transient failure leaves the version unchanged; the next pulse retries.
      .catch(() => {})
      .finally(() => { pending.current = false; });
  }, [access, user, revalidate, routeError, navigate, onRefresh]);

  return null;
};

export default AccessSync;
