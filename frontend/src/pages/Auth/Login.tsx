import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";

import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  AuthHeading,
  AuthPanel,
  WaysIn,
  type Way,
} from "../../components/Auth/AuthPanel";
import { useAuthPrefs } from "./Layout";
import { API, INLINE_STATUSES, inlineError, storeSession } from "./session";

type LoginFailure = { message: string; locked: boolean; email: string };

export async function loader() {
  document.title = "Вход";
  return null;
}

export async function action({ request }: { request: Request }) {
  const data = await request.formData();
  const email = String(data.get("email") || "").trim();

  const response = await fetch(`${API}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: data.get("password") }),
  });

  if (!response.ok) {
    if (!INLINE_STATUSES.includes(response.status)) {
      throw response;
    }
    const failure = await inlineError(response, "Не удалось войти.");
    return { ...failure, email };
  }

  await storeSession(await response.json());
  return redirect("/");
}

const Login = () => {
  const prefs = useAuthPrefs();
  const failure = useActionData() as LoginFailure | undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const submitting = navigation.state === "submitting";
  const passwordChanged = searchParams.get("reset") === "success";

  const ways: Way[] = [
    // Почта выключена — ссылку слать нечем, и путь не обещаем
    prefs.emailIsActive
      ? { label: "Получить пароль", to: "/auth/password" }
      : null,
    prefs.selfSignupIsActive
      ? { label: "Впервые здесь", to: "/auth/signup" }
      : null,
    prefs.contacts.email
      ? {
          label: "Написать в поддержку",
          href: `mailto:${prefs.contacts.email}`,
        }
      : null,
  ].filter(Boolean) as Way[];

  return (
    <AuthPanel>
      <AuthHeading title="Вход" />

      {passwordChanged && (
        <AlertMessage
          variant="success"
          message="Пароль изменён. Войдите с новым."
        />
      )}
      {failure && (
        <AlertMessage
          // Блокировка по числу попыток — не ошибка ввода: тон другой
          variant={failure.locked ? "warning" : "danger"}
          message={failure.message}
        />
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
            defaultValue={failure?.email ?? ""}
            aria-invalid={failure && !failure.locked ? true : undefined}
            placeholder="name@company.ru"
          />
        </Field>

        <Field label="Пароль" htmlFor="password" required>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            aria-invalid={failure && !failure.locked ? true : undefined}
          />
        </Field>

        <Button type="submit" disabled={submitting} className="mt-1 w-full">
          {submitting ? "Вход…" : "Войти"}
        </Button>
      </Form>

      <WaysIn title="Не получается войти" ways={ways} />
    </AuthPanel>
  );
};

export default Login;
