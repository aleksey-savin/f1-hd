import { Form, useActionData, useNavigation } from "react-router";
import { RiMailSendLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  AuthHeading,
  AuthPanel,
  AuthTile,
  WaysIn,
  type Way,
} from "../../components/Auth/AuthPanel";
import { useAuthPrefs } from "./Layout";
import { API, OFFLINE_FAILURE, authFailure } from "./session";

type Result =
  | { sent: true; email: string }
  | { sent: false; message: string; email: string };

export async function loader() {
  document.title = "Пароль по почте";
  return null;
}

export async function action({ request }: { request: Request }) {
  const data = await request.formData();
  const email = String(data.get("email") || "").trim();

  // Штатная ручка better-auth. Прежняя `/api/forgot-password` удалена вместе
  // со своей механикой: она отвечала честным 404 «пользователь не найден»,
  // то есть работала проверялкой чужих адресов, и парковала СЫРОЙ токен
  // восстановления в документе пользователя.
  //
  // Ответ здесь одинаковый независимо от того, существует адрес или нет —
  // поэтому экран всегда показывает «письмо отправлено».
  let response: Response;
  try {
    response = await fetch(`${API}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { sent: false, message: OFFLINE_FAILURE.message, email };
  }

  if (!response.ok) {
    const failure = await authFailure(response, "Не удалось отправить письмо.");
    return { sent: false, message: failure.message, email };
  }

  return { sent: true, email };
}

const PasswordRequest = () => {
  const prefs = useAuthPrefs();
  const result = useActionData() as Result | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const ways: Way[] = [
    { label: "Вернуться ко входу", to: "/auth" },
    prefs.contacts.email
      ? {
          label: "Написать в поддержку",
          href: `mailto:${prefs.contacts.email}`,
        }
      : null,
  ].filter(Boolean) as Way[];

  if (result?.sent) {
    return (
      <AuthPanel>
        <AuthTile tone="success">
          <RiMailSendLine size={20} />
        </AuthTile>
        <AuthHeading
          title="Письмо отправлено"
          lede={
            <>
              Ссылка на смену пароля ушла на <b>{result.email}</b> и живёт
              сутки. Не пришло — проверьте спам или напишите нам.
            </>
          }
        />
        <WaysIn title="Ещё варианты" ways={ways} />
      </AuthPanel>
    );
  }

  return (
    <AuthPanel>
      <AuthHeading
        title="Пароль по почте"
        lede="Пришлём ссылку на смену пароля. Она живёт сутки."
      />

      {result && !result.sent && (
        <AlertMessage variant="danger" message={result.message} />
      )}

      <Form method="post" className="mt-5">
        <Field label="Рабочая почта" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            defaultValue={result?.email ?? ""}
            aria-invalid={result && !result.sent ? true : undefined}
            placeholder="name@company.ru"
          />
        </Field>

        <Button type="submit" disabled={submitting} className="mt-1 w-full">
          {submitting ? "Отправляем…" : "Отправить ссылку"}
        </Button>
      </Form>

      <WaysIn title="Ещё варианты" ways={ways} />
    </AuthPanel>
  );
};

export default PasswordRequest;
