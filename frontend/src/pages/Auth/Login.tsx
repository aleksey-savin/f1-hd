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
import {
  API,
  OFFLINE_FAILURE,
  authFailure,
  storeSession,
} from "./session";

type LoginFailure = { message: string; locked: boolean; email: string };
/**
 * Второй фактор: пароль принят, но сеанса ещё нет. Состояние проверки живёт в
 * подписанной cookie на сервере, поэтому клиенту нести нечего — только знать,
 * что нужен шаг с кодом.
 */
type TwoFactorPending = { twoFactor: true; email: string };
type CodeFailure = LoginFailure & { twoFactorStep: true };
type LoginResult = LoginFailure | CodeFailure | TwoFactorPending;

/** Шаг с кодом: либо пароль только что принят, либо код не подошёл. */
const onCodeStep = (result?: LoginResult) =>
  Boolean(result && ("twoFactor" in result || "twoFactorStep" in result));

export async function loader() {
  document.title = "Вход";
  return null;
}

export async function action({ request }: { request: Request }) {
  const data = await request.formData();
  const email = String(data.get("email") || "").trim();
  const code = String(data.get("code") || "").trim();
  const backup = data.get("backup") === "true";

  // Второй шаг уходит на свою ручку: проверка идёт по cookie, выданной первым
  // шагом, и пароль ей уже не нужен.
  const url = code ? `${API}/api/login/two-factor` : `${API}/api/login`;
  const body = code
    ? { code, backup }
    : { email, password: data.get("password") };

  // Экран входа не бросает НИЧЕГО: уходить с него человеку некуда, а
  // введённый адрес при этом теряется. Сеть оборвалась — тоже сюда.
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Cookie второго фактора — та же дорога, что у сессионной: без неё
      // сервер не знает, чей вход подтверждают.
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    return { ...OFFLINE_FAILURE, email };
  }

  if (!response.ok) {
    const failure = await authFailure(response, "Не удалось войти.");
    // Ошибка кода не должна выбрасывать обратно к паролю: человек его уже
    // ввёл верно, и повторять весь вход из-за опечатки в шести цифрах — то,
    // что раздражает в чужих порталах.
    return code ? { ...failure, email, twoFactorStep: true } : { ...failure, email };
  }

  const payload = await response.json();

  if (payload?.twoFactorRequired) {
    return { twoFactor: true as const, email };
  }

  // Ответ передаём целиком: токен сеанса приезжает заголовком
  // `set-auth-token`, а поле `token` тела оставлено для совместимости.
  await storeSession(payload, response);
  return redirect("/");
}

const Login = () => {
  const prefs = useAuthPrefs();
  const result = useActionData() as LoginResult | undefined;
  const codeStep = onCodeStep(result);
  // На шаге кода плашка ошибки нужна, а «ошибка ввода почты» — уже нет.
  const failure =
    result && "message" in result ? (result as LoginFailure) : undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const submitting = navigation.state === "submitting";
  const passwordChanged = searchParams.get("reset") === "success";

  const ways: Way[] = [
    // Почта выключена — письмо слать нечем, и путь не обещаем.
    // Дорога ОДНА: что уйдёт — ссылка для входа или ссылка на смену пароля —
    // решает сервер по тому, кто это. Две почтовые дороги рядом читались бы
    // как одно и то же, а выбрать верную человек всё равно не может.
    prefs.emailIsActive
      ? { label: "Прислать письмо", to: "/auth/password" }
      : null,
    // Пути «Впервые здесь» больше нет: саморегистрация удалена, учётки заводит
    // ИТ-отдел вместе с почтой и остальными доступами.
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

      {codeStep ? (
        /**
         * Второй шаг того же входа, а не отдельный экран: пароль уже принят,
         * поэтому та же карточка и тот же заголовок. Своего адреса у шага нет
         * намеренно — прийти на него, минуя пароль, нельзя.
         */
        <Form method="post" className="mt-5">
          <Field
            label="Код из приложения"
            htmlFor="code"
            required
            hint="Шесть цифр, меняются раз в 30 секунд."
          >
            <Input
              id="code"
              name="code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-invalid={failure ? true : undefined}
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          </Field>

          <Button type="submit" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Проверяем…" : "Войти"}
          </Button>

          {/* Резервным кодом пользуются раз в жизни — он вторичен и по виду.
              Тот же submit, только с признаком: отдельная форма потеряла бы
              введённое значение при переключении. */}
          <Button
            type="submit"
            name="backup"
            value="true"
            variant="ghost"
            disabled={submitting}
            className="mt-2 w-full"
          >
            Ввести резервный код
          </Button>
        </Form>
      ) : (
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
      )}

      {!codeStep && <WaysIn title="Не получается войти" ways={ways} />}
    </AuthPanel>
  );
};

export default Login;
