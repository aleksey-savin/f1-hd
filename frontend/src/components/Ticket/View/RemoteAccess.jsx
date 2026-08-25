import { useCallback, useContext, useEffect } from "react";

import { RiRemoteControlLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";

import useHttp from "../../../hooks/use-http";
import { AuthedUserContext } from "../../../store/authed-user-context";
import { useCan } from "@/store/authed-user";
import useInitialPrefsStore from "../../../store/prefs";
import usePro32ConnectStore from "../../../store/pro32-connect";
import useToastStore from "../../../store/toast-store";
import { getLocalStorageData } from "../../../util/auth";

/**
 * Удалённое подключение к экрану заявителя (Pro32 Connect) — tw-двойник
 * `Integrations/Pro32Connect` для карточки заявки: там кнопка нарисована
 * инлайновым зелёным bootstrap-стилем и в новой шапке смотрелась чужой.
 *
 * Механика прежняя: сессии нет — «Пригласить» её создаёт, есть — «Подключиться»
 * ведёт по ссылке. Конечный пользователь видит только «Разрешить подключение».
 * Легаси-компонент остаётся у навбара и виджета главной.
 *
 * Подписи начинаются с «PRO32»: рядом стоят действия самой заявки, и без имени
 * сервиса «Пригласить» читается как приглашение коллеги в заявку.
 */
const RemoteAccess = ({ ticket }) => {
  const { token } = getLocalStorageData();
  const { isEndUser } = useContext(AuthedUserContext);
  const can = useCan();
  const { getScreen } = useInitialPrefsStore();
  const { connectUrl, inviteUrl, setConnectionState } = usePro32ConnectStore();
  const { showToast } = useToastStore();
  const { sendRequest: fetchConnection } = useHttp();
  const { sendRequest: createSession, isLoading } = useHttp();

  const active = !!getScreen?.isActive && ticket.state === "В работе";

  const load = useCallback(() => {
    if (!active) return;
    fetchConnection(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/support/connection/${ticket.num}`,
      },
      (data) =>
        setConnectionState({
          connectUrl: data?._id ? data.connectUrl : "",
          inviteUrl: data?._id ? data.inviteUrl : "",
        }),
    );
  }, [active, fetchConnection, setConnectionState, ticket.num, token]);

  useEffect(() => {
    load();
  }, [load]);

  if (!active) return null;

  const invite = () =>
    createSession(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/support/create`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: { user: ticket.applicant?._id, ticketNum: ticket.num },
      },
      (data) => {
        if (data?._id) {
          setConnectionState({
            connectUrl: data.connectUrl,
            inviteUrl: data.inviteUrl,
          });
        } else {
          showToast("danger", data?.message || "Не удалось создать сессию");
        }
      },
    );

  if (isEndUser) {
    return inviteUrl ? (
      <Button asChild variant="outline">
        <a href={inviteUrl} target="_blank" rel="noreferrer">
          <RiRemoteControlLine /> PRO32 Разрешить подключение
        </a>
      </Button>
    ) : null;
  }

  // Сеанс заводит тот, кому это разрешено. Раньше кнопку видел любой
  // сотрудник, а сервер с этого релиза спрашивает право.
  if (!can({ remoteSupport: ["use"] })) return null;

  return connectUrl ? (
    <Button asChild variant="outline">
      <a href={connectUrl} target="_blank" rel="noreferrer">
        <RiRemoteControlLine /> PRO32 Подключиться
      </a>
    </Button>
  ) : (
    <Button variant="outline" onClick={invite} disabled={isLoading}>
      <RiRemoteControlLine />
      {isLoading ? "Приглашаем…" : "PRO32 Пригласить"}
    </Button>
  );
};

export default RemoteAccess;
