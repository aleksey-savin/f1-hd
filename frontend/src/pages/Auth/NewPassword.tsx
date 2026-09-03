import {
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { RiLinkUnlinkM } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import { MIN_LENGTH } from "@/lib/password";
import { Button } from "@/components/ui/button";

import {
  AuthHeading,
  AuthPanel,
  AuthTile,
  WaysIn,
} from "../../components/Auth/AuthPanel";
import NewPasswordForm from "../../components/Auth/NewPasswordForm";
import { API, OFFLINE_FAILURE, authFailure } from "./session";

// Своего числа здесь нет: минимум приходит из `lib/password`, который держит
// его в одном месте со всеми формами пароля. Проверка в экшене — страховка на
// случай отправки в обход поля (без JS, автозаполнением).

export async function loader() {
  document.title = "Новый пароль";

  // Предпроверки ссылки больше нет: ручка `/api/validate-reset-token/:token`
  // удалена вместе с легаси-механикой. Она к тому же была без лимитера, то
  // есть позволяла перебирать токен в течение суток его жизни. Годность
  // ссылки теперь выясняется при отправке — сервер отвечает по существу.
  return { valid: true };
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
    return { message: `Пароль не короче ${MIN_LENGTH} знаков.` };
  }

  // Штатная ручка better-auth: она же гасит все сеансы этого человека
  // (`revokeSessionsOnPasswordReset`) и делает токен одноразовым.
  let response: Response;
  try {
    response = await fetch(`${API}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: params.token, newPassword: password }),
    });
  } catch {
    return { message: OFFLINE_FAILURE.message };
  }

  if (!response.ok) {
    const failure = await authFailure(response, "Не удалось сменить пароль.");
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
        <AuthHeading
          tile={
            <AuthTile tone="warning">
              <RiLinkUnlinkM size={20} />
            </AuthTile>
          }
          title="Ссылка больше не работает"
          lede="Она живёт сутки с момента запроса. Запросите новое письмо — придёт свежее."
        />
        {/* Та же дверь, что на входе: клиенту придёт код, сотруднику — новая
            ссылка. Какое письмо нужно, решает сервер по адресу. */}
        <Button asChild className="mt-5 w-full">
          <Link to="/auth/code">Запросить новое письмо</Link>
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

      {/* Токен — из адреса страницы, форме его нести не нужно */}
      <NewPasswordForm submitting={submitting} />

      <WaysIn
        title="Ещё варианты"
        ways={[{ label: "Вернуться ко входу", to: "/auth" }]}
      />
    </AuthPanel>
  );
};

export default NewPassword;
