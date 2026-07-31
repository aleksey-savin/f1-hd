import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { RiLinkUnlinkM } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import { Button } from "@/components/ui/button";

import {
  AuthHeading,
  AuthPanel,
  AuthTile,
  WaysIn,
} from "../../components/Auth/AuthPanel";
import { API, INLINE_STATUSES, inlineError } from "./session";

const MIN_LENGTH = 6;

export async function loader({ params }: { params: { token?: string } }) {
  document.title = "Новый пароль";

  try {
    const response = await fetch(
      `${API}/api/validate-reset-token/${params.token}`,
    );
    return { valid: response.ok };
  } catch {
    // Сетевой сбой — не повод объявлять ссылку мёртвой: пусть человек
    // попробует сохранить, сервер ответит по существу
    return { valid: true };
  }
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { token?: string };
}) {
  const data = await request.formData();
  const password = String(data.get("password") || "");

  if (password.length < MIN_LENGTH) {
    return { message: `Пароль не короче ${MIN_LENGTH} символов.` };
  }

  const response = await fetch(`${API}/api/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: params.token, password }),
  });

  if (!response.ok) {
    if (!INLINE_STATUSES.includes(response.status)) {
      throw response;
    }
    const failure = await inlineError(response, "Не удалось сменить пароль.");
    return { message: failure.message };
  }

  // На вход, а не на дашборд: сеанса у смены пароля нет
  return redirect("/auth?reset=success");
}

const NewPassword = () => {
  const { valid } = useLoaderData() as { valid: boolean };
  const failure = useActionData() as { message: string } | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (!valid) {
    return (
      <AuthPanel>
        <AuthTile tone="warning">
          <RiLinkUnlinkM size={20} />
        </AuthTile>
        <AuthHeading
          title="Ссылка больше не работает"
          lede="Она живёт сутки с момента запроса. Запросите новую — придёт свежее письмо."
        />
        <Button asChild className="tw:mt-5 tw:w-full">
          <Link to="/auth/password">Запросить новую</Link>
        </Button>
        <WaysIn
          title="Ещё варианты"
          ways={[{ label: "Вернуться ко входу", to: "/auth" }]}
        />
      </AuthPanel>
    );
  }

  return (
    <AuthPanel>
      <AuthHeading title="Новый пароль" />

      {failure && <AlertMessage variant="danger" message={failure.message} />}

      <Form method="post" className="tw:mt-5">
        <Field
          label="Новый пароль"
          htmlFor="password"
          required
          hint={`Не короче ${MIN_LENGTH} символов`}
        >
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            autoFocus
            aria-invalid={failure ? true : undefined}
          />
        </Field>

        <Button type="submit" disabled={submitting} className="tw:mt-1 tw:w-full">
          {submitting ? "Сохраняем…" : "Сохранить пароль"}
        </Button>
      </Form>

      <WaysIn
        title="Ещё варианты"
        ways={[{ label: "Вернуться ко входу", to: "/auth" }]}
      />
    </AuthPanel>
  );
};

export default NewPassword;
