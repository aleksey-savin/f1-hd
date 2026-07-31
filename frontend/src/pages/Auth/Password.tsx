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
import { API, INLINE_STATUSES, inlineError } from "./session";

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

  // Ровно один запрос: прежний экшен слал его дважды — уходило два письма и
  // выписывалось два токена, из которых работал последний
  const response = await fetch(`${API}/api/forgot-password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    if (!INLINE_STATUSES.includes(response.status)) {
      throw response;
    }
    const failure = await inlineError(response, "Не удалось отправить письмо.");
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

      <Form method="post" className="tw:mt-5">
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

        <Button type="submit" disabled={submitting} className="tw:mt-1 tw:w-full">
          {submitting ? "Отправляем…" : "Отправить ссылку"}
        </Button>
      </Form>

      <WaysIn title="Ещё варианты" ways={ways} />
    </AuthPanel>
  );
};

export default PasswordRequest;
