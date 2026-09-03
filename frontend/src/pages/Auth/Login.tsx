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
import TwoFactorStep from "../../components/Auth/TwoFactorStep";
import { useAuthPrefs } from "./Layout";
import { API, signIn } from "./session";

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
  const outcome = await signIn(url, body, "Не удалось войти.");

  if (outcome.status === "failed") {
    // Ошибка кода не должна выбрасывать обратно к паролю: человек его уже
    // ввёл верно, и повторять весь вход из-за опечатки в шести цифрах — то,
    // что раздражает в чужих порталах.
    return code
      ? { ...outcome.failure, email, twoFactorStep: true }
      : { ...outcome.failure, email };
  }
  if (outcome.status === "two-factor") {
    return { twoFactor: true as const, email };
  }

  // Сеанс. Исход «новый пароль» у парольного входа не случается.
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
    // Дорога ОДНА: клиенту придёт код для входа, сотруднику — ссылка на смену
    // пароля (сотрудник входит паролем и вторым фактором). Что уйдёт, решает
    // сервер по адресу; спрашивать это у человека — вопрос «вы клиент или
    // сотрудник», который не его забота.
    prefs.emailIsActive
      ? { label: "Войти по коду из письма", to: "/auth/code" }
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
         * поэтому та же карточка и тот же заголовок.
         */
        <TwoFactorStep submitting={submitting} invalid={Boolean(failure)} />
      ) : (
      <Form method="post" className="mt-5">
        {/* Звёздочек обязательности нет: у входа оба поля обязательны, и
            это очевидно без пометки. */}
        <Field label="Рабочая почта" htmlFor="email">
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

        <Field label="Пароль" htmlFor="password">
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
