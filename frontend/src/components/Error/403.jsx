import { Link } from "react-router";

import { Button } from "@/components/ui/button";

import ErrorScreen from "./ErrorScreen";

const Forbidden = () => (
  <ErrorScreen
    code={["4", "3"]}
    title="Сюда нужен доступ"
    body="У вашей учётной записи нет прав на этот раздел. Если он нужен для работы — попросите администратора выдать доступ."
    actions={
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    }
    tech={{ tone: "warning", text: "403 · доступ ограничен правами" }}
  />
);

export default Forbidden;
