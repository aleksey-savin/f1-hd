import { cn } from "@/lib/utils";
import { formatPhone, phoneHref } from "@/util/phone";

// Телефон текстом: «+7 (914) 555-01-42» ссылкой «позвонить», цифры табличные.
// Номер, который не набрать (старые данные без кода города), — просто текст.
// Цвет и подчёркивание ссылки задаёт место (className).
const PhoneLink = ({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) => {
  const text = formatPhone(value);
  if (!text) return null;
  const href = phoneHref(value);
  return href ? (
    <a href={href} className={cn("tabular-nums", className)}>
      {text}
    </a>
  ) : (
    <span className="tabular-nums">{text}</span>
  );
};

export default PhoneLink;
