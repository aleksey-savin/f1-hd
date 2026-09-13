import { useEffect } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import useWorkStatusesStore from "@/store/work-statuses";

/**
 * The only fetcher of colleagues' presence (`/api/users/work-statuses`): the
 * rail, «Команда сейчас», the users list, the user card and the navbar's own
 * status all read the store. Mounted once in layout/Root for staff; refetches
 * when the pulse says presence moved.
 */
const PresenceSync = () => {
  const silentRefresh = useWorkStatusesStore((state) => state.silentRefresh);

  useEffect(() => {
    void silentRefresh();
  }, [silentRefresh]);

  useLiveTopic("presence", silentRefresh);

  return null;
};

export default PresenceSync;
