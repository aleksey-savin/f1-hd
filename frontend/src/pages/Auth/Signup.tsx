import { useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { RiCheckLine, RiErrorWarningLine, RiMailLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  AuthHeading,
  AuthPanel,
  WaysIn,
  type Way,
} from "../../components/Auth/AuthPanel";
import { useCompanyByEmail } from "../../hooks/use-company-by-email";
import { useAuthPrefs } from "./Layout";
import { API, INLINE_STATUSES, inlineError, storeSession } from "./session";

const MIN_LENGTH = 6;

export async function loader() {
  document.title = "Регистрация";
  return null;
}

export async function action({ request }: { request: Request }) {
  const data = await request.formData();
  const payload = {
    email: String(data.get("email") || "").trim(),
    firstName: String(data.get("firstName") || "").trim(),
    lastName: String(data.get("lastName") || "").trim(),
    password: String(data.get("password") || ""),
  };

  // POST, а не PUT: прежний экшен слал PUT на маршрут, объявленный как POST
  const response = await fetch(`${API}/api/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (!INLINE_STATUSES.includes(response.status)) {
      throw response;
    }
    const failure = await inlineError(response, "Не удалось зарегистрироваться.");
    // Возвращаем что перенабирать, но БЕЗ пароля: данные экшена живут в
    // памяти роутера и видны в devtools, а секрету там делать нечего
    const { password: _password, ...values } = payload;
    return { message: failure.message, values };
  }

  await storeSession(await response.json());
  return redirect("/");
}

/**
 * Строка ответа поля почты. Цветом красим только иконку и само состояние —
 * пояснение остаётся приглушённым (правило «статуса-фразы» из гайда).
 */
const Resolution = ({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "warn" | "info";
  icon: ReactNode;
  children: ReactNode;
}) => (
  <p
    className={cn(
      "tw:mt-2 tw:mb-0 tw:flex tw:items-start tw:gap-2 tw:text-sm",
      tone === "ok" ? "tw:text-accent-text" : "tw:text-muted-foreground",
    )}
  >
    <span
      className={cn(
        "tw:mt-0.5 tw:flex-none",
        tone === "warn" && "tw:text-warning",
        tone === "info" && "tw:text-faint",
      )}
      aria-hidden
    >
      {icon}
    </span>
    <span>{children}</span>
  </p>
);

const Signup = () => {
  const prefs = useAuthPrefs();
  const failure = useActionData() as
    | { message: string; values: { email: string; firstName: string; lastName: string } }
    | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [email, setEmail] = useState(failure?.values.email ?? "");
  const { resolution } = useCompanyByEmail(email);

  const supportHref = prefs.contacts.email
    ? `mailto:${prefs.contacts.email}`
    : null;

  // Домен чужой — регистрация вернёт 404, адрес занят — 409. Кнопка, ведущая
  // в отказ, обещает то, чего интерфейс не держит: подменяем её тем, чего
  // человеку на самом деле не хватает (правило «Действия на странице сущности»)
  const takenAddress = resolution?.registered === true;
  const foreignDomain =
    resolution?.status === "unknown" && Boolean(supportHref);
  const blocked = takenAddress || foreignDomain;

  const ways: Way[] = [
    !takenAddress && prefs.emailIsActive
      ? { label: "Получить пароль", to: "/auth/password" }
      : null,
    { label: "Войти", to: "/auth" },
    !foreignDomain && supportHref
      ? { label: "Написать в поддержку", href: supportHref }
      : null,
  ].filter(Boolean) as Way[];

  return (
    <AuthPanel>
      <AuthHeading title="Регистрация" />

      {failure && <AlertMessage variant="danger" message={failure.message} />}

      <Form method="post" className="tw:mt-5">
        <Field label="Рабочая почта" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={failure ? true : undefined}
            placeholder="name@company.ru"
          />
        </Field>

        {resolution?.registered && (
          <Resolution tone="info" icon={<RiMailLine size={16} />}>
            Такой адрес уже зарегистрирован — пароль можно получить по почте.
          </Resolution>
        )}
        {!resolution?.registered && resolution?.status === "known" && (
          <Resolution tone="ok" icon={<RiCheckLine size={16} />}>
            <b className="tw:font-semibold">{resolution.company?.title}</b> —
            узнали по адресу
          </Resolution>
        )}
        {!resolution?.registered && resolution?.status === "unknown" && (
          <Resolution tone="warn" icon={<RiErrorWarningLine size={16} />}>
            Не узнаём этот адрес. Регистрация доступна только с рабочей почтой.
          </Resolution>
        )}

        {/* Поля гаснут и блокируются вместе с подменой кнопки: заполнять их
            незачем — этот адрес зарегистрировать не выйдет */}
        <div className={cn("tw:mt-4", blocked && "tw:opacity-50")}>
          <div className="tw:grid tw:gap-3 tw:sm:grid-cols-2">
            <Field label="Имя" htmlFor="firstName" required>
              <Input
                id="firstName"
                name="firstName"
                required
                disabled={blocked}
                autoComplete="given-name"
                defaultValue={failure?.values.firstName ?? ""}
              />
            </Field>
            <Field label="Фамилия" htmlFor="lastName" required>
              <Input
                id="lastName"
                name="lastName"
                required
                disabled={blocked}
                autoComplete="family-name"
                defaultValue={failure?.values.lastName ?? ""}
              />
            </Field>
          </div>

          <Field
            label="Пароль"
            htmlFor="password"
            required
            hint={`Не короче ${MIN_LENGTH} символов`}
          >
            <PasswordInput
              id="password"
              name="password"
              required
              disabled={blocked}
              minLength={MIN_LENGTH}
              autoComplete="new-password"
            />
          </Field>
        </div>

        {takenAddress ? (
          <Button asChild className="tw:mt-1 tw:w-full">
            <Link to="/auth/password">Получить пароль</Link>
          </Button>
        ) : foreignDomain ? (
          <Button asChild className="tw:mt-1 tw:w-full">
            <a href={supportHref as string}>Написать в поддержку</a>
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={submitting}
            className="tw:mt-1 tw:w-full"
          >
            {submitting ? "Регистрируем…" : "Зарегистрироваться"}
          </Button>
        )}
      </Form>

      <WaysIn title="Уже были здесь" ways={ways} />
    </AuthPanel>
  );
};

export default Signup;
