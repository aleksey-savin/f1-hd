import { Link } from "react-router";

import { Button } from "@/components/ui/button";

import ErrorScreen from "./ErrorScreen";

const InternalServerError = ({ status }) => (
  <ErrorScreen
    code={["5", "0"]}
    title="Что-то сломалось у нас"
    body="Мы уже знаем об ошибке и разбираемся. Попробуйте обновить страницу — обычно это помогает."
    actions={
      <>
        <Button onClick={() => window.location.reload()}>
          Обновить страницу
        </Button>
        <Button asChild variant="outline">
          <Link to="/">На главную</Link>
        </Button>
      </>
    }
    tech={{
      tone: "destructive",
      text: `${status || 500} · отчёт отправлен автоматически`,
    }}
  />
);

export default InternalServerError;
