import { useState, useEffect, useCallback, useContext } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router";

import useHttp from "../../hooks/use-http";

import { getScreenActions } from "../../store/getScreen";
import { toastActions } from "../../store/toast";

import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";

import { getInitialPrefsData } from "../../util/prefs";
import { RiMacbookLine } from "react-icons/ri";

import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const GetScreen = (props) => {
  const params = useParams();
  const { token } = getLocalStorageData();
  const { role: userRole, isEndUser } = useContext(AuthedUserContext);
  const { getScreen } = getInitialPrefsData();

  const getScreenIsActive = getScreen.isActive;

  const dispatch = useDispatch();

  const connectUrl = useSelector((state) => state.getScreen.connectUrl);
  const inviteUrl = useSelector((state) => state.getScreen.inviteUrl);
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
          dispatch(
            getScreenActions.setConnectionState({
              connectUrl: data.connectUrl,
              inviteUrl: data.inviteUrl,
            }),
          );
          setCanConnect(true);
          props.refreshData();
        } else {
          dispatch(
            toastActions.setState({
              variant: "danger text-white",
              message: data.message,
              show: true,
            }),
          );
        }
      },
    );
  }, [fetchSupport, setCanConnect, token, dispatch, props.refreshData]);

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
          dispatch(
            getScreenActions.setConnectionState({
              connectUrl: data.connectUrl,
              inviteUrl: data.inviteUrl,
            }),
          );
        } else {
          dispatch(
            getScreenActions.setConnectionState({
              connectUrl: "",
              inviteUrl: "",
            }),
          );
        }
      },
    );
  }, [fetchConnectionHandler, token, params.ticketNum, dispatch]);

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
                  variant="primary"
                  size="lg"
                  className="w-100 mb-2"
                  onClick={submitGetSupport}
                >
                  <RiMacbookLine /> <strong>Пригласить Клиента</strong>
                </Button>
              )}
              {connectUrl && (
                <Button
                  variant="primary"
                  size="lg"
                  className="w-100 mb-2"
                  href={connectUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>
                    <RiMacbookLine /> Присоединиться
                  </strong>
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
              >
                <strong>
                  <RiMacbookLine /> Разрешить удалённое подключение
                </strong>
              </a>
            </Col>
          )}
        </>
      )}
    </>
  );
};

export default GetScreen;
