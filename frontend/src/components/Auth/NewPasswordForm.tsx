import { useState, type ReactNode } from "react";
import { Form } from "react-router";

import PasswordPolicyField from "@/components/app/PasswordPolicyField";
import { verdictAllows, type PasswordVerdict } from "@/lib/password";
import { Button } from "@/components/ui/button";

/**
 * Форма нового пароля — общая для ссылки из письма и для кода из письма.
 *
 * Поле — то же, что во всех местах, где задают пароль: живой вердикт и
 * генератор. Здесь оно нужнее всего — рядом нет администратора, который
 * объяснит, почему дата рождения не подходит.
 *
 * Чем подтверждается право сменить пароль (токен ссылки или адрес и код),
 * знает вызывающий: он кладёт это скрытыми полями в `children`.
 */
const NewPasswordForm = ({
  submitting,
  children,
}: {
  submitting: boolean;
  children?: ReactNode;
}) => {
  const [password, setPassword] = useState("");
  const [verdict, setVerdict] = useState<PasswordVerdict>({ kind: "idle" });

  return (
    <Form method="post" className="mt-5 flex flex-col gap-4">
      {children}
      <PasswordPolicyField
        id="password"
        value={password}
        onChange={setPassword}
        onVerdictChange={setVerdict}
        autoFocus
      />
      <input type="hidden" name="password" value={password} />

      <Button
        type="submit"
        disabled={submitting || !verdictAllows(verdict)}
        className="w-full"
      >
        {submitting ? "Сохраняем…" : "Сохранить пароль"}
      </Button>
    </Form>
  );
};

export default NewPasswordForm;
