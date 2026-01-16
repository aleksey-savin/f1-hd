import { useState, useEffect, useCallback, useContext } from "react";
import { useParams } from "react-router";

import useHttp from "../../../hooks/use-http";

import usePro32ConnectStore from "../../../store/pro32-connect";
import useToastStore from "../../../store/toast-store";

import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";

import { getInitialPrefsData } from "../../../util/prefs";
import Pro32ConnectIcon from "../../../../public/pro32_connect_icon.svg";

import { AuthedUserContext } from "../../../store/authed-user-context";
import { getLocalStorageData } from "../../../util/auth";

const GetScreen = (props) => {
  const params = useParams();

  const { connectUrl, inviteUrl, setConnectionState } = usePro32ConnectStore();
  const { token } = getLocalStorageData();
  const { role: userRole, isEndUser } = useContext(AuthedUserContext);
  const { getScreen } = getInitialPrefsData();

  const getScreenIsActive = getScreen.isActive;

  const { showToast } = useToastStore();

  const [canConnect, setCanConnect] = useState(connectUrl ? true : false);

  useEffect(() => {
    setCanConnect(connectUrl ? true : false);
  }, [connectUrl, props.refreshData]);

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
          user: props.ticket.applicant._id,
          ticketNum: props.ticket.num,
        },
      },
      (data) => {
        if (data._id) {
          setConnectionState({
            connectUrl: data.connectUrl,
            inviteUrl: data.inviteUrl,
          });
          setCanConnect(true);
          props.refreshData();
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
    props.refreshData,
    props.ticket.applicant._id,
    props.ticket.num,
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
  }, [fetchConnection, userRole, props.refreshData, getScreenIsActive]);

  return (
    <>
      {getScreenIsActive && props.ticket.state === "В работе" && (
        <>
          {!isEndUser && (
            <Col sm="auto">
              {!canConnect && (
                <Button
                  size="lg"
                  className="w-100 mb-2 text-center"
                  style={{ backgroundColor: "#00be28", borderColor: "#00be28" }}
                  onClick={submitGetSupport}
                >
                  <div>
                    <img
                      src={Pro32ConnectIcon}
                      alt="Pro32 Connect"
                      className="me-1"
                    />
                    <strong>Пригласить</strong>
                  </div>
                </Button>
              )}
              {connectUrl && (
                <Button
                  style={{ backgroundColor: "#00be28", borderColor: "#00be28" }}
                  size="lg"
                  className="w-100 mb-2"
                  href={connectUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={Pro32ConnectIcon}
                    alt="Pro32 Connect"
                    className="me-1"
                  />
                  <strong>Присоединиться</strong>
                </Button>
              )}
            </Col>
          )}
          {isEndUser && canConnect && (
            <Col sm="auto">
              <a
                className="btn btn-primary btn-lg w-100"
                href={inviteUrl}
                target="_blank"
                rel="noreferrer"
                style={{ backgroundColor: "#00be28", borderColor: "#00be28" }}
              >
                <img
                  src={Pro32ConnectIcon}
                  alt="Pro32 Connect"
                  className="me-1"
                />
                <strong>Разрешить</strong>
                удалённое подключение
              </a>
            </Col>
          )}
        </>
      )}
    </>
  );
};

export default GetScreen;
