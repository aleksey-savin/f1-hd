import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  editPhoneInput,
  pastePhoneInput,
  phoneInputError,
  phoneInputText,
  phoneWireValue,
  type PhoneEdit,
  type PhoneTyped,
} from "@/util/phone";

// Единственное поле телефона в приложении (макет «Единый формат телефонов»).
// Показывает номер маской «+7 (914) 555-01-42»; после «+» и не 7 — номер другой
// страны, «+375291234567». Отдаёт «+цифры»: скрытым полем `name` — формам на
// FormData, через onValueChange — формам на состоянии; бэкенд хранит цифры без
// плюса (services/phone.js). Ошибка — строкой под полем: после ухода с поля, по
// попытке отправки (showErrors или нативная проверка формы) и сразу — у
// негодного номера из старых данных.
const PhoneInput = ({
  id = "phone",
  name,
  value = "",
  onValueChange,
  showErrors = false,
  disabled = false,
  autoFocus = false,
  autoComplete = "off",
  className,
}: {
  id?: string;
  /** Имя скрытого поля с «+цифрами» — для форм на FormData. */
  name?: string;
  /** Канон из базы, «+цифры» из состояния формы или старые цифры. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Показать ошибку, не дожидаясь ухода с поля: форма пробовала отправиться. */
  showErrors?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Автозаполнение браузера: `"tel"` — только в своём профиле, в остальных формах номер чужой. */
  autoComplete?: string;
  /** Ширина и прочее для самого поля (`w-72` в настройках). */
  className?: string;
}) => {
  const [text, setText] = useState(() => phoneInputText(value));
  const [wire, setWire] = useState(() => phoneWireValue(value));
  // Негодный номер из старых данных виден сразу: иначе форма молча не уйдёт
  const [touched, setTouched] = useState(() =>
    Boolean(phoneInputError(phoneWireValue(value))),
  );
  // Каждая правка перерисовывает поле, даже если текст не изменился (набрали
  // букву): иначе React вернёт прежнее значение и каретка уедет в конец
  const [, setEdits] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  const error = phoneInputError(wire);
  const visibleError = error && (touched || showErrors) ? error : null;

  // Нативная проверка: форма на FormData не отправится с негодным номером
  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? "");
  }, [error]);

  // Каретка — после той же цифры, что до переформатирования
  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = caretRef.current;
    caretRef.current = null;
    if (caret === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
  });

  const apply = (next: PhoneTyped | PhoneEdit) => {
    caretRef.current = "caret" in next ? next.caret : next.text.length;
    setText(next.text);
    setEdits((count) => count + 1);
    if (next.wire !== wire) {
      setWire(next.wire);
      onValueChange?.(next.wire);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
    apply(
      editPhoneInput(
        text,
        input.value,
        input.selectionStart ?? input.value.length,
        inputType,
      ),
    );
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const parsed = pastePhoneInput(event.clipboardData.getData("text"));
    const selectAll =
      input.selectionStart === 0 && input.selectionEnd === text.length;
    // Готовый номер из буфера заменяет поле целиком — даже после набранного «+7»; обрывок встаёт как обычный ввод
    const whole =
      !text ||
      selectAll ||
      (parsed.wire !== "" && !phoneInputError(parsed.wire));
    if (!whole) return;
    event.preventDefault();
    apply(parsed);
  };

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        value={text}
        onChange={handleChange}
        onPaste={handlePaste}
        onBlur={() => setTouched(true)}
        onInvalid={(event) => {
          // Своя строка под полем вместо всплывашки браузера
          event.preventDefault();
          setTouched(true);
          event.currentTarget.focus();
        }}
        placeholder="+7 (___) ___-__-__"
        aria-invalid={visibleError ? true : undefined}
        aria-describedby={visibleError ? `${id}-error` : undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        className={cn("tabular-nums", className)}
      />
      {name && (
        <input type="hidden" name={name} value={wire} disabled={disabled} />
      )}
      {visibleError && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 mb-0 text-sm text-destructive"
        >
          {visibleError}
        </p>
      )}
    </>
  );
};

export default PhoneInput;
