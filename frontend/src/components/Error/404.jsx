import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuthedUser } from "@/store/authed-user";

import ErrorScreen from "./ErrorScreen";
import { resolveEntityContext } from "./entity-context";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isEndUser } = useAuthedUser();
  const entity = resolveEntityContext(location.pathname, { isEndUser });

  return (
    <ErrorScreen
      code={["4", "4"]}
      title={entity?.title ?? "Здесь ничего нет"}
      body={
        entity?.body ??
        "Похоже, ссылка устарела или в адресе опечатка. Начните с главной — там всё на месте."
      }
      actions={
        // Главная кнопка — список раздела, если он у человека есть (у клиента
        // списка заявок нет, и вещь названа, а вести некуда); иначе — главная
        <>
          {entity?.listTo && (
            <Button asChild>
              <Link to={entity.listTo}>{entity.listLabel}</Link>
            </Button>
          )}
          <Button asChild variant={entity?.listTo ? "outline" : "default"}>
            <Link to="/">На главную</Link>
          </Button>
          {!entity?.listTo && (
            <Button variant="outline" onClick={() => navigate(-1)}>
              Назад
            </Button>
          )}
        </>
      }
      tech={{ tone: "muted", text: `404 · ${location.pathname}` }}
    />
  );
};

export default NotFound;
