import { useEffect, useRef, useState } from "react";
import QRCodeStyling from "qr-code-styling";
import { RiFileCopyLine, RiCheckLine, RiDownloadLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import AlertMessage from "@/components/app/AlertMessage";
import { api, ApiError } from "@/lib/api";
import useToastStore from "@/store/toast-store";

/**
 * Включение второго фактора: пароль → приложение → код → резервные коды.
 *
 * Подтверждение кодом ОБЯЗАТЕЛЬНО, хотя плагин умеет включать и без него.
 * Человек с неверно настроенным приложением иначе запирает себя снаружи и идёт
 * к администратору — один лишний экран дешевле одного такого случая.
 *
 * Резервные коды показываются РОВНО ОДИН РАЗ: сервер отдаёт их при включении и
 * больше нигде не хранит в открытом виде. Отсюда и галочка «сохранил» — это
 * единственное место в портале, где мы просим подтвердить прочитанное.
 */

/** QR рисуется во внутреннем высоком разрешении — иначе модули округляются. */
const RES = 1024;

const Qr = ({ uri, size = 168 }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !uri) return;
    // Очистка контейнера перед перерисовкой. replaceChildren, а не
    // innerHTML: разметку сюда никто не подставляет, и выглядеть это
    // должно так же однозначно, как и работает.
    ref.current.replaceChildren();
    const qr = new QRCodeStyling({
      width: RES,
      height: RES,
      type: "svg",
      data: uri,
      margin: 0,
      qrOptions: { errorCorrectionLevel: "M" },
      // Фон всегда белый, а не по теме: сканеры на тёмном коде по тёмному
      // фону спотыкаются, и это ровно тот случай, где красота не стоит риска.
      backgroundOptions: { color: "#ffffff" },
      dotsOptions: { type: "rounded", color: "#14253a" },
      cornersSquareOptions: { type: "extra-rounded", color: "#14253a" },
      cornersDotOptions: { type: "dot", color: "#2a4a6e" },
    });
    qr.append(ref.current);
    const svg = ref.current.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${RES} ${RES}`);
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
  }, [uri, size]);

  return (
    <div
      ref={ref}
      className="flex-none rounded-[10px] bg-white p-2 inset-ring inset-ring-border"
      style={{ width: size + 16, height: size + 16 }}
    />
  );
};

const CopyButton = ({ value, label = "Скопировать" }) => {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
        } catch {
          // Буфер недоступен (страница не на https) — значение видно целиком
          // и выделяется руками.
        }
      }}
    >
      {done ? <RiCheckLine /> : <RiFileCopyLine />}
      {done ? "Скопировано" : label}
    </Button>
  );
};

const TwoFactorSetup = ({ email, open, onOpenChange, onDone }) => {
  const [step, setStep] = useState("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState(null);
  const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setStep("password");
    setPassword("");
    setCode("");
    setSecret(null);
    setCodes([]);
    setSaved(false);
    setError("");
  }, [open]);

  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth/two-factor/enable", {
        method: "POST",
        body: { password },
      });
      setSecret({
        uri: data.totpURI,
        // Ключ для ручного ввода — тот же секрет из ссылки. Группами по
        // четыре: так его переписывают без ошибок.
        key: (new URL(data.totpURI).searchParams.get("secret") || "")
          .replace(/(.{4})/g, "$1 ")
          .trim(),
      });
      setCodes(data.backupCodes || []);
      setStep("scan");
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Не удалось начать настройку",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/two-factor/verify-totp", {
        method: "POST",
        body: { code: code.replace(/\s/g, "") },
      });
      setStep("codes");
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Код не подошёл. Проверьте время на телефоне.",
      );
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        `Резервные коды для входа — ${email}\n`,
        `Каждый работает один раз.\n\n`,
        codes.join("\n"),
        "\n",
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const finish = () => {
    useToastStore.getState().showToast("success", "Второй фактор включён");
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === "password" && "Включить вход по коду"}
            {step === "scan" && "Отсканируйте код"}
            {step === "verify" && "Введите код из приложения"}
            {step === "codes" && "Сохраните резервные коды"}
          </DialogTitle>
          <DialogDescription>
            {step === "password" &&
              "Подтвердите, что это вы: дальше понадобится приложение-аутентификатор на телефоне."}
            {step === "scan" &&
              "Откройте приложение на телефоне и наведите камеру. Подойдёт любое: Google Authenticator, 1Password, Яндекс Ключ."}
            {step === "verify" &&
              "Так мы убедимся, что приложение настроено верно."}
            {step === "codes" &&
              "Каждый код работает один раз и заменяет код из приложения, если телефон недоступен."}
          </DialogDescription>
        </DialogHeader>

        {error && <AlertMessage variant="danger" message={error} />}

        {step === "password" && (
          <Field label="Текущий пароль" htmlFor="tf-password" required className="mb-0">
            <PasswordInput
              id="tf-password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        )}

        {step === "scan" && (
          <div className="flex flex-wrap gap-4">
            <Qr uri={secret.uri} />
            <div className="flex min-w-[180px] flex-1 flex-col gap-2">
              <span className="text-xs font-semibold tracking-wider text-faint uppercase">
                Если камера недоступна
              </span>
              <div className="rounded-lg border border-border bg-accent px-3 py-2 font-mono text-sm break-all">
                {secret.key}
              </div>
              <span className="text-sm text-faint">
                Введите этот ключ в приложении вручную.
              </span>
              <div>
                <CopyButton value={secret.key.replace(/\s/g, "")} label="Скопировать ключ" />
              </div>
            </div>
          </div>
        )}

        {step === "verify" && (
          <Field label="Код из приложения" htmlFor="tf-code" required className="mb-0">
            <Input
              id="tf-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          </Field>
        )}

        {step === "codes" && (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-border bg-accent px-3.5 py-3 font-mono text-sm">
              {codes.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={download}>
                <RiDownloadLine /> Скачать файлом
              </Button>
              <CopyButton value={codes.join("\n")} />
            </div>

            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
              Показываются <strong>один раз</strong>. Закроете окно — увидеть их
              снова будет нельзя, только выпустить новые.
            </div>

            <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
                className="mt-0.5 size-4"
              />
              Я сохранил коды в надёжном месте
            </label>
          </>
        )}

        <DialogFooter>
          {step === "password" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button onClick={enable} disabled={busy || !password}>
                Дальше
              </Button>
            </>
          )}
          {step === "scan" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button onClick={() => setStep("verify")}>Дальше</Button>
            </>
          )}
          {step === "verify" && (
            <>
              <Button variant="ghost" onClick={() => setStep("scan")}>
                Назад
              </Button>
              <Button onClick={confirm} disabled={busy || code.trim().length < 6}>
                Подтвердить
              </Button>
            </>
          )}
          {step === "codes" && (
            <Button onClick={finish} disabled={!saved}>
              Готово
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TwoFactorSetup;
