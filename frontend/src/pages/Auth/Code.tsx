import { Form, redirect, useActionData, useNavigation } from "react-router";
import { RiMailSendLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import { MIN_LENGTH } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  AuthHeading,
  AuthPanel,
  AuthTile,
  WaysIn,
  type Way,
} from "../../components/Auth/AuthPanel";
import NewPasswordForm from "../../components/Auth/NewPasswordForm";
import TwoFactorStep from "../../components/Auth/TwoFactorStep";
import { useAuthPrefs } from "./Layout";
import {
  API,
  INLINE_STATUSES,
  OFFLINE_FAILURE,
  authFailure,
  inlineError,
  signIn,
} from "./session";

/**
 * Письмо не ушло. Сервер отправляет его сразу, не откладывая в очередь, и
 * отвечает ошибкой, если не смог; текст — свой, а не общий «сервер не смог
 * обработать запрос»: человек ждёт письмо, и ему важно именно это.
 */
const SEND_FAILURE = "При отправке письма произошла ошибка";

/**
 * ОДНА ДВЕРЬ для тех, кто не может войти паролем: «Войти по коду из письма».
 *
 * До ввода кода экран для всех один: адрес, письмо, код. Расходятся дороги
 * после верного кода, и решает это сервер по адресу: клиент просто входит
 * (пароля у большинства клиентов никогда и не было; включён второй фактор —
 * ещё код из приложения); сотрудник задаёт новый пароль и дальше входит
 * паролем и вторым фактором. До верного кода экран различия не знает и знать
 * не может: ответ на запрос одинаковый и для незнакомого адреса — иначе
 * ручка стала бы проверялкой чужих адресов.
 *
 * Шаги живут на одном адресе, состояние — в данных экшена: адрес → код из
 * письма → код из приложения ИЛИ новый пароль. Своего адреса у поздних
 * шагов нет намеренно: прийти на них, минуя предыдущий, нельзя.
 */
type Result =
  | { step: "email"; email: string; message: string }
  | { step: "code"; email: string; message?: string; resent?: boolean }
  | { step: "two-factor"; email: string; message?: string }
  | { step: "password"; email: string; otp: string; message?: string };

export async function loader() {
  document.title = "Вход по коду";
  return null;
}

export async function action({ request }: { request: Request }) {
  const data = await request.formData();
  const email = String(data.get("email") || "").trim();
  const otp = String(data.get("otp") || "").trim();
  const code = String(data.get("code") || "").trim();
  const password = String(data.get("password") || "");

  // Последний шаг сотрудника: новый пароль. Код уходит второй раз — на шаге
  // кода его только проверяли, гасится он вместе с паролем. Минимум длины —
  // страховка на случай отправки в обход поля (см. NewPassword).
  if (password) {
    const back = (message: string) => ({
      step: "password" as const,
      email,
      otp,
      message,
    });
    if (password.length < MIN_LENGTH) {
      return back(`Пароль не короче ${MIN_LENGTH} знаков.`);
    }

    let response: Response;
    try {
      response = await fetch(`${API}/api/login-code/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, password }),
      });
    } catch {
      return back(OFFLINE_FAILURE.message);
    }
    if (!response.ok) {
      const failure = await authFailure(response, "Не удалось сменить пароль.");
      return back(failure.message);
    }

    // На вход, а не в приложение: сеанса у смены пароля нет — сотрудник
    // входит паролем и вторым фактором.
    return redirect("/auth?reset=success");
  }

  // Третий шаг клиента: код из приложения. Ручка та же, что у парольного входа —
  // состояние проверки живёт в cookie, и ей всё равно, чем был первый шаг.
  if (code) {
    const outcome = await signIn(
      `${API}/api/login/two-factor`,
      { code, backup: data.get("backup") === "true" },
      "Не удалось войти.",
    );
    if (outcome.status === "session") return redirect("/");
    return {
      step: "two-factor" as const,
      email,
      message: outcome.status === "failed" ? outcome.failure.message : undefined,
    };
  }

  // Второй шаг: код из письма. Неверный код оставляет на этом же шаге —
  // письмо уже пришло, и заново просить адрес из-за опечатки незачем.
  if (otp) {
    const outcome = await signIn(
      `${API}/api/login-code/verify`,
      { email, otp },
      "Не удалось войти.",
    );
    if (outcome.status === "session") return redirect("/");
    if (outcome.status === "two-factor") {
      return { step: "two-factor" as const, email };
    }
    if (outcome.status === "password-reset") {
      return { step: "password" as const, email, otp };
    }
    return { step: "code" as const, email, message: outcome.failure.message };
  }

  // Первый шаг (и «прислать ещё раз»): запрос кода.
  let response: Response;
  try {
    response = await fetch(`${API}/api/login-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { step: "email" as const, email, message: OFFLINE_FAILURE.message };
  }

  if (!response.ok) {
    // Ограничитель попыток объясняет себя сам — его текст показываем; всё
    // остальное для человека одно: письмо не ушло.
    const failure = INLINE_STATUSES.includes(response.status)
      ? await inlineError(response, SEND_FAILURE)
      : { message: SEND_FAILURE };
    return { step: "email" as const, email, message: failure.message };
  }

  return {
    step: "code" as const,
    email,
    resent: data.get("resend") === "true",
  };
}

const LoginCode = () => {
  const prefs = useAuthPrefs();
  const result = useActionData() as Result | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const support: Way | null = prefs.contacts.email
    ? { label: "Написать в поддержку", href: `mailto:${prefs.contacts.email}` }
    : null;

  if (result?.step === "password") {
    return (
      <AuthPanel>
        <AuthHeading
          title="Новый пароль"
          lede="Код принят. Задайте пароль — по нему и рабочей почте вы входите в портал."
        />
        {result.message && (
          <AlertMessage variant="danger" message={result.message} />
        )}
        <NewPasswordForm submitting={submitting}>
          <input type="hidden" name="email" value={result.email} />
          <input type="hidden" name="otp" value={result.otp} />
        </NewPasswordForm>
        <WaysIn
          title="Ещё варианты"
          ways={[{ label: "Вернуться ко входу", to: "/auth" }]}
        />
      </AuthPanel>
    );
  }

  if (result?.step === "two-factor") {
    return (
      <AuthPanel>
        <AuthHeading
          title="Код из приложения"
          lede="Код из письма принят. Остался второй фактор — код из приложения-аутентификатора."
        />
        {result.message && (
          <AlertMessage variant="danger" message={result.message} />
        )}
        <TwoFactorStep
          submitting={submitting}
          invalid={Boolean(result.message)}
        />
      </AuthPanel>
    );
  }

  if (result?.step === "code") {
    const ways = [
      { label: "Другой адрес", to: "/auth/code" },
      { label: "Вернуться ко входу", to: "/auth" },
      support,
    ].filter(Boolean) as Way[];

    return (
      <AuthPanel>
        <AuthHeading
          tile={
            <AuthTile tone="success">
              <RiMailSendLine size={20} />
            </AuthTile>
          }
          title="Код отправлен"
          lede={
            <>
              Письмо с кодом отправлено на <b>{result.email}</b>. Если не
              пришло, пожалуйста, проверьте папку Спам или запросите код ещё
              раз.
            </>
          }
        />

        {result.resent && (
          <AlertMessage variant="success" message="Код отправлен ещё раз." />
        )}
        {result.message && (
          <AlertMessage variant="danger" message={result.message} />
        )}

        <Form method="post" className="mt-5">
          <input type="hidden" name="email" value={result.email} />
          <Field
            label="Код из письма"
            htmlFor="otp"
            // Срок — `loginCodeTtlSeconds` в backend/auth/config.js
            hint="Шесть цифр, код действует 15 минут."
          >
            <Input
              id="otp"
              name="otp"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-invalid={result.message ? true : undefined}
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          </Field>

          {/* «Продолжить», а не «Войти»: что будет после кода — сеанс, код из
              приложения или новый пароль, — экран ещё не знает. */}
          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Проверяем…" : "Продолжить"}
          </Button>
        </Form>

        {/* Повторная отправка — своя форма: терять в ней нечего, а общий
            submit с кодом заставил бы различать намерения по кнопке. */}
        <Form method="post" className="mt-2">
          <input type="hidden" name="email" value={result.email} />
          <input type="hidden" name="resend" value="true" />
          <Button
            type="submit"
            variant="ghost"
            disabled={submitting}
            className="w-full"
          >
            Прислать код ещё раз
          </Button>
        </Form>

        <WaysIn title="Ещё варианты" ways={ways} />
      </AuthPanel>
    );
  }

  const ways = [
    { label: "Вернуться ко входу", to: "/auth" },
    support,
  ].filter(Boolean) as Way[];
  const failed = result?.step === "email" ? result : undefined;

  return (
    <AuthPanel>
      <AuthHeading title="Вход по коду" lede="Пришлём код для входа на почту." />

      {failed && <AlertMessage variant="danger" message={failed.message} />}

      <Form method="post" className="mt-5">
        <Field label="Рабочая почта" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            defaultValue={failed?.email ?? ""}
            aria-invalid={failed ? true : undefined}
            placeholder="name@company.ru"
          />
        </Field>

        <Button type="submit" disabled={submitting} className="mt-1 w-full">
          {submitting ? "Отправляем…" : "Прислать код"}
        </Button>
      </Form>

      <WaysIn title="Ещё варианты" ways={ways} />
    </AuthPanel>
  );
};

export default LoginCode;
