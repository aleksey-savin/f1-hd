import { useEffect, useCallback, useState } from "react";

import useHttp from "../hooks/use-http";
import { getLocalStorageData } from "../util/auth";

import Alert from "react-bootstrap/Alert";
import { Link } from "react-router";

const ChangelogAlert = () => {
  const { token } = getLocalStorageData();

  const isLoggedIn = !!token;

  const [changelogUpdate, setChangelogUpdate] = useState(false);

  const { sendRequest: changelogUpdatesHandler } = useHttp();
  const checkChangelogUpdates = useCallback(() => {
    changelogUpdatesHandler(
      {
        url: `${import.meta.env.VITE_ADDRESS}/api/changelog/check-updates`,
        headers: {
          Authorization: "Bearer " + token,
        },
      },
      (data) => {
        setChangelogUpdate(data.pending);
      },
    );
  }, [changelogUpdatesHandler, token]);

  useEffect(() => {
    if (isLoggedIn) {
      checkChangelogUpdates();
    } else {
      setChangelogUpdate(false);
    }
  }, [checkChangelogUpdates, setChangelogUpdate, isLoggedIn]);

  const { sendRequest: disableChangelogNotificationHandler } = useHttp();
  const disableChangelogNotification = useCallback(() => {
    disableChangelogNotificationHandler(
      {
        url: `${import.meta.env.VITE_ADDRESS}/api/users/disable-changelog`,
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
      },
      () => {
        setChangelogUpdate(false);
      },
    );
  }, [disableChangelogNotificationHandler, setChangelogUpdate, token]);

  return (
    <>
      {changelogUpdate && (
        <Alert
          variant="info"
          onClose={disableChangelogNotification}
          dismissible
        >
          Мы выпустили обновление!{" "}
          <Alert.Link
            as={Link}
            to="/changelog"
            onClick={disableChangelogNotification}
          >
            Узнать что нового.
          </Alert.Link>
        </Alert>
      )}
    </>
  );
};

export default ChangelogAlert;
