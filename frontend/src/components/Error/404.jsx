import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";

import ErrorScreen from "./ErrorScreen";
import { resolveEntityContext } from "./entity-context";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const entity = resolveEntityContext(location.pathname);

  return (
    <ErrorScreen
      code={["4", "4"]}
      title={entity?.title ?? "Здесь ничего нет"}
      body={
        entity?.body ??
        "Похоже, ссылка устарела или в адресе опечатка. Начните с главной — там всё на месте."
      }
      actions={
        entity ? (
          <>
            <Button asChild>
              <Link to={entity.listTo}>{entity.listLabel}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">На главную</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild>
              <Link to="/">На главную</Link>
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Назад
            </Button>
          </>
        )
      }
      tech={{ tone: "muted", text: `404 · ${location.pathname}` }}
    />
  );
};

export default NotFound;
