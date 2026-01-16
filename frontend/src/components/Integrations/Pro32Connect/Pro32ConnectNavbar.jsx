import { useState, useEffect, useCallback, useContext } from "react";
import { useParams } from "react-router";

import useHttp from "../../../hooks/use-http";
import usePro32ConnectStore from "../../../store/pro32-connect";
import useViewTicketStore from "../../../store/view-ticket";
import useToastStore from "../../../store/toast-store";

import Button from "react-bootstrap/Button";

import { getInitialPrefsData } from "../../../util/prefs";
import { RiMacbookLine } from "react-icons/ri";

import { AuthedUserContext } from "../../../store/authed-user-context";
import { getLocalStorageData } from "../../../util/auth";

const Pro32ConnectNavbar = () => {
  const params = useParams();

  const { ticket } = useViewTicketStore();
  const { connectUrl, inviteUrl, setConnectionState } = usePro32ConnectStore();
  const { token } = getLocalStorageData();
  const { role: userRole, isEndUser } = useContext(AuthedUserContext);
  const { getScreen } = getInitialPrefsData();

  const getScreenIsActive = getScreen.isActive;
  const { showToast } = useToastStore();

  const [canConnect, setCanConnect] = useState(connectUrl ? true : false);

  useEffect(() => {
    setCanConnect(connectUrl ? true : false);
  }, [connectUrl]);

  const { sendRequest: fetchSupport } = useHttp();

  const support = useCallback(() => {
    fetchSupport(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/support/create`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: {
          user: ticket.applicant?._id,
          ticketNum: ticket.num,
        },
      },
      (data) => {
        if (data._id) {
          setConnectionState({
            connectUrl: data.connectUrl,
            inviteUrl: data.inviteUrl,
          });
          setCanConnect(true);
        } else {
          showToast("danger text-white", data.message);
        }
      },
    );
  }, [
    fetchSupport,
    setCanConnect,
    token,
    setConnectionState,
    showToast,
    ticket.applicant?._id,
    ticket.num,
  ]);

  const submitGetSupport = (event) => {
    event.preventDefault();
    support();
  };

  const { sendRequest: fetchConnectionHandler } = useHttp();

  const fetchConnection = useCallback(async () => {
    await fetchConnectionHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/support/connection/${params.ticketNum}`,
        headers: {
          Authorization: "Bearer " + token,
        },
      },
      (data) => {
        if (data._id) {
          setConnectionState({
            connectUrl: data.connectUrl,
            inviteUrl: data.inviteUrl,
          });
        } else {
          setConnectionState({
            connectUrl: "",
            inviteUrl: "",
          });
        }
      },
    );
  }, [fetchConnectionHandler, token, params.ticketNum, setConnectionState]);

  useEffect(() => {
    if (getScreenIsActive) {
      fetchConnection();
    }
  }, [fetchConnection, userRole, getScreenIsActive]);

  // Don't render if no ticket data or ticket is not in work state
  if (!ticket._id || !getScreenIsActive) {
    return null;
  }

  return (
    <>
      {!isEndUser && (
        <>
          {!canConnect && (
            <Button
              style={{ backgroundColor: "#00be28" }}
              onClick={submitGetSupport}
            >
              <RiMacbookLine className="me-1" />
              Pro32 | Пригласить
            </Button>
          )}
          {connectUrl && (
            <Button
              style={{ backgroundColor: "#00be28" }}
              href={connectUrl}
              target="_blank"
              rel="noreferrer"
            >
              <RiMacbookLine className="me-1" />
              Pro32 | Подключиться
            </Button>
          )}
        </>
      )}
      {isEndUser && canConnect && (
        <Button
          className="btn btn-sm me-2"
          href={inviteUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            backgroundColor: "#00be28",
          }}
        >
          <RiMacbookLine className="me-1" />
          Pro32 | Разрешить подключение
        </Button>
      )}
    </>
  );
};

export default Pro32ConnectNavbar;
