import { Form, redirect, useActionData, useNavigation } from "react-router";

import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { AuthHeading, AuthPanel } from "../../components/Auth/AuthPanel";
import { API, INLINE_STATUSES, inlineError, storeSession } from "./session";

const MIN_LENGTH = 6;

export async function loader() {
  document.title = "Первый запуск";
  return null;
}

export async function action({ request }: { request: Request }) {
  const data = await request.formData();
  const payload = Object.fromEntries(data);

  const response = await fetch(`${API}/api/first-launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (!INLINE_STATUSES.includes(response.status)) {
      throw response;
    }
    const failure = await inlineError(response, "Не удалось создать компанию.");
    // Пароль в данные экшена не возвращаем — им там не место
    const { userPassword: _password, ...values } = payload;
    return { message: failure.message, values };
  }

  // Сервер отдаёт сеанс — человек ввёл этот пароль полминуты назад, и
  // возвращать его на форму входа значит сделать вид, что пароль не подошёл
  await storeSession(await response.json());
  return redirect("/");
}

const Setup = () => {
  const failure = useActionData() as
    | { message: string; values: Record<string, string> }
    | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const was = failure?.values ?? {};

  return (
    <AuthPanel>
      <AuthHeading title="Первый запуск" />

      {failure && <AlertMessage variant="danger" message={failure.message} />}

      <Form method="post" className="tw:mt-5">
        <Field label="Название компании" htmlFor="companyFullTitle" required>
          <Input
            id="companyFullTitle"
            name="companyFullTitle"
            required
            autoFocus
            defaultValue={was.companyFullTitle ?? ""}
          />
        </Field>

        <div className="tw:grid tw:gap-3 tw:sm:grid-cols-2">
          <Field label="Имя" htmlFor="userFirstName" required>
            <Input
              id="userFirstName"
              name="userFirstName"
              required
              autoComplete="given-name"
              defaultValue={was.userFirstName ?? ""}
            />
          </Field>
          <Field label="Фамилия" htmlFor="userLastName" required>
            <Input
              id="userLastName"
              name="userLastName"
              required
              autoComplete="family-name"
              defaultValue={was.userLastName ?? ""}
            />
          </Field>
        </div>

        <Field label="Рабочая почта" htmlFor="userEmail" required>
          <Input
            id="userEmail"
            name="userEmail"
            type="email"
            required
            autoComplete="email"
            defaultValue={was.userEmail ?? ""}
          />
        </Field>

        <Field
          label="Пароль"
          htmlFor="userPassword"
          required
          hint={`Не короче ${MIN_LENGTH} символов`}
        >
          <PasswordInput
            id="userPassword"
            name="userPassword"
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
          />
        </Field>

        <Button type="submit" disabled={submitting} className="tw:mt-1 tw:w-full">
          {submitting ? "Сохраняем…" : "Сохранить"}
        </Button>
      </Form>
    </AuthPanel>
  );
};

export default Setup;
