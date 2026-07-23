import { Link } from "react-router";
import {
  RiCalendarScheduleLine,
  RiFileList3Line,
  RiTicketLine,
} from "react-icons/ri";

import ListRow from "@/components/app/ListRow";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const pluralFields = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "поле";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "поля";
  return "полей";
};

// «ООО «Ромашка» +2» / «Пётр Петров +1» — первый получатель + счётчик остальных.
const sharingLabel = (companies, users) => {
  const total = companies.length + users.length;
  if (total === 0) return null;
  const first =
    companies[0]?.alias ??
    `${users[0]?.lastName ?? ""} ${users[0]?.firstName ?? ""}`.trim();
  const rest = total - 1;
  return rest > 0 ? `${first} +${rest}` : first;
};

const TicketTemplateItem = ({ item }) => {
  const {
    title,
    customFields = [],
    checklist = [],
    allowAllStaff,
    sharedCompanies = [],
    sharedUsers = [],
  } = item;

  const fieldsCount = customFields.length;
  const clientShare = sharingLabel(sharedCompanies, sharedUsers);
  const accessLabel = allowAllStaff
    ? "Всем сотрудникам"
    : (clientShare ?? "Личный");
  const accessAccent = allowAllStaff || !!clientShare;

  const meta = [
    `${fieldsCount} ${pluralFields(fieldsCount)}`,
    checklist.length ? `чек-лист ${checklist.length}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const trailing = (
    <span
      className={
        accessAccent
          ? "tw:inline-flex tw:items-center tw:gap-2 tw:text-sm tw:font-medium tw:text-accent-text tw:max-md:hidden"
          : "tw:inline-flex tw:items-center tw:gap-2 tw:text-sm tw:font-medium tw:text-faint tw:max-md:hidden"
      }
    >
      <span
        aria-hidden
        className={
          accessAccent
            ? "tw:size-1.5 tw:rounded-full tw:bg-primary"
            : "tw:size-1.5 tw:rounded-full tw:bg-faint"
        }
      />
      {accessLabel}
    </span>
  );

  return (
    <ListRow
      item={item}
      itemTitle="ticketTemplate"
      monogram={<RiFileList3Line className="tw:size-6" />}
      title={title}
      meta={meta}
      trailing={trailing}
      detailTo={`/ticket-templates/${item._id}`}
      extraActions={
        <>
          <DropdownMenuItem asChild>
            <Link to={`/tickets/add?template=${item._id}`}>
              <RiTicketLine /> Создать заявку
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/routine-tasks/add?fromTemplate=${item._id}`}>
              <RiCalendarScheduleLine /> Создать регламент
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      }
    />
  );
};

export default TicketTemplateItem;
