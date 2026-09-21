import { Link } from "react-router";
import {
  RiPhoneLine,
  RiMailLine,
  RiMapPinLine,
  RiComputerLine,
  RiFileCopyLine,
  RiArrowRightLine,
} from "react-icons/ri";

import useToastStore from "@/store/toast-store";
import { useCan } from "@/store/authed-user";
import { cn } from "@/lib/utils";

import UserAvatar from "./UserAvatar";

/**
 * Карточка контакта человека — содержимое, одно на две оболочки: нижнюю шторку
 * адресной книги (`User/ContactSheet`) и попап инициатора в карточке заявки
 * (`Ticket/View/ApplicantPopup`). Плитка-аватар, имя, строка «кто это», строка
 * состояния и каналы связи крупными строками с копированием.
 *
 * `compact` — размеры попапа у имени (макет «Инициатор в заявке», вариант A);
 * без него — размеры шторки, под палец.
 *
 * Оболочка решает, что стоит строкой состояния (`status`): в адресной книге это
 * присутствие или «последнее обращение», в заявке — местное время абонента.
 */
// Отказ копирования называем вслух: на http и в старых вебвью буфера нет, и
// молчащая кнопка читалась бы как сломанная
const copyToClipboard = (text, label) => {
  const { showToast } = useToastStore.getState();
  if (!navigator?.clipboard) {
    showToast("danger", "Копирование недоступно");
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => showToast("success", `${label} скопирован`))
    .catch(() => showToast("danger", "Не удалось скопировать"));
};

const channelClass =
  "flex items-center gap-2 rounded-xl border border-border p-1.5";
const channelIconClass =
  "grid size-9 flex-none place-items-center rounded-lg bg-primary/15 text-primary";
const copyBtnClass =
  "grid size-9 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-muted-foreground active:bg-accent";

const Channel = ({ icon, label, value, href, external, copy, compact }) => {
  const linkClass = cn(
    "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-foreground no-underline active:bg-accent",
    compact ? "p-1.5" : "p-2",
  );
  const body = (
    <>
      <span className={channelIconClass}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-faint">{label}</span>
        <span className="block truncate font-medium tabular-nums">{value}</span>
      </span>
    </>
  );

  return (
    <div className={channelClass}>
      {href ? (
        <a
          href={href}
          className={linkClass}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {body}
        </a>
      ) : (
        <span className={linkClass}>{body}</span>
      )}
      <button
        type="button"
        onClick={() => copyToClipboard(copy.value, copy.label)}
        className={copyBtnClass}
        aria-label={copy.aria}
        title="Скопировать"
      >
        <RiFileCopyLine size={17} />
      </button>
    </div>
  );
};

const ContactCard = ({
  item,
  /** Строка «кто это» под именем: должность · компания или подразделение. */
  meta,
  /** Строка состояния под ней — её приносит оболочка. */
  status,
  /** Адрес: `{ value, source, mapLink }`. */
  address,
  /** Компьютер человека: `{ name, label }` (заявка знает его из AD-логов). */
  computer,
  compact = false,
  ringColor,
  /** Состояние маршрута для крошки возврата с карточки человека. */
  profileState,
  /** Перед переходом в профиль — закрыть оболочку. */
  onNavigate,
}) => {
  // Карточка человека закрыта правом «Видеть пользователей»: без него это
  // остаётся карточкой контактов, а кнопка не ведёт в отказ
  const canReadUsers = !!useCan()({ user: ["read"] });

  const { _id, firstName, lastName, email, phone } = item;
  const fullName = `${lastName ?? ""} ${firstName ?? ""}`.trim();
  const iconSize = compact ? 18 : 19;

  return (
    <>
      <div
        className={cn(
          "flex items-center pr-8",
          compact ? "mb-3.5 gap-3" : "mb-5 gap-4",
        )}
      >
        <UserAvatar
          user={item}
          sizeClass={compact ? "size-11" : "size-15"}
          textClass={compact ? "text-base" : "text-xl"}
          ringColor={ringColor}
        />
        <div className="min-w-0">
          <div
            className={cn(
              "truncate font-semibold",
              compact ? "text-base" : "text-lg",
            )}
          >
            {fullName || "—"}
          </div>
          {meta && (
            <div className="truncate text-sm text-muted-foreground">{meta}</div>
          )}
          {status}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {phone && (
          <Channel
            compact={compact}
            icon={<RiPhoneLine size={iconSize} />}
            label="Позвонить"
            value={phone}
            href={`tel:${phone}`}
            copy={{
              value: phone,
              label: "Телефон",
              aria: "Скопировать телефон",
            }}
          />
        )}
        {email && (
          <Channel
            compact={compact}
            icon={<RiMailLine size={iconSize} />}
            label="Написать"
            value={email}
            href={`mailto:${email}`}
            copy={{ value: email, label: "Почта", aria: "Скопировать почту" }}
          />
        )}
        {computer?.name && (
          <Channel
            compact={compact}
            icon={<RiComputerLine size={iconSize} />}
            label={computer.label || "Компьютер"}
            value={computer.name}
            copy={{
              value: computer.name,
              label: "Имя компьютера",
              aria: "Скопировать имя компьютера",
            }}
          />
        )}
        {address?.value && (
          <Channel
            compact={compact}
            icon={<RiMapPinLine size={iconSize} />}
            label={`Адрес${address.source ? ` · ${address.source}` : ""}`}
            value={address.value}
            href={address.mapLink || undefined}
            external
            copy={{
              value: address.value,
              label: "Адрес",
              aria: "Скопировать адрес",
            }}
          />
        )}
        {!phone && !email && !computer?.name && !address?.value && (
          <p className="my-0 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Контакты не указаны
          </p>
        )}
      </div>

      {canReadUsers && _id && (
        <Link
          to={`/users/${_id}`}
          state={profileState}
          onClick={onNavigate}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground no-underline hover:bg-primary/90 active:bg-primary/90",
            compact ? "mt-3 h-10 text-sm" : "mt-4 h-11",
          )}
        >
          Открыть профиль
          <RiArrowRightLine size={18} />
        </Link>
      )}
    </>
  );
};

export default ContactCard;
