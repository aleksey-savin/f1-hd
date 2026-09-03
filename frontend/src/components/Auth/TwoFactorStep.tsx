import { Form } from "react-router";

import Field from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Шаг с кодом из приложения — общий для входа по паролю и по коду из письма.
 *
 * Своего адреса у шага нет намеренно — прийти на него, минуя первый шаг,
 * нельзя. Состояние проверки живёт в подписанной cookie на сервере, поэтому
 * форма шлёт только код: экшен страницы отправляет его в
 * `POST /api/login/two-factor` (см. `session.ts#signIn`).
 *
 * Резервным кодом пользуются раз в жизни — он вторичен и по виду. Тот же
 * submit, только с признаком: отдельная форма потеряла бы введённое значение
 * при переключении.
 */
const TwoFactorStep = ({
  submitting,
  invalid = false,
}: {
  submitting: boolean;
  /** Прошлый код не подошёл — поле помечается, плашку рисует страница. */
  invalid?: boolean;
}) => (
  <Form method="post" className="mt-5">
    {/* Звёздочки обязательности на пред-авторизационных экранах нет:
        единственное поле формы обязательно и так. */}
    <Field
      label="Код из приложения"
      htmlFor="code"
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
        aria-invalid={invalid ? true : undefined}
        className="text-center font-mono text-2xl tracking-[0.4em]"
      />
    </Field>

    <Button type="submit" disabled={submitting} className="mt-1 w-full">
      {submitting ? "Проверяем…" : "Войти"}
    </Button>

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
);

export default TwoFactorStep;
