import { Link } from "react-router";
import { RiMailLine, RiPhoneLine } from "react-icons/ri";

import { Eyebrow, Panel, SubLabel } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

// Ответственные лица — две группы строками-людьми в одной панели. Данные —
// снапшоты на компании (могут иметь только fullName), поэтому аватар — простая
// монограмма, а профиль открывается по имени, если снапшот хранит id.
const getFullName = (person) =>
  person.fullName ||
  [person.lastName, person.firstName].filter(Boolean).join(" ") ||
  "Без имени";

const iconLinkClass =
  "tw:grid tw:size-8 tw:flex-none tw:cursor-pointer tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:no-underline tw:transition-colors tw:hover:bg-border-soft tw:hover:text-foreground";

const PersonRow = ({ person }) => {
  const name = getFullName(person);
  const inactive = person.isActive === false;
  const profileId = person.id?._id || person.id;

  return (
    <div className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:first:border-t-0">
      <span
        aria-hidden
        className={cn(
          "tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border",
          inactive && "tw:opacity-60",
        )}
      >
        {monogramFor(name)}
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div
          className={cn(
            "tw:truncate tw:text-[15px] tw:leading-tight tw:font-medium",
            inactive && "tw:text-muted-foreground",
          )}
        >
          {profileId ? (
            <Link
              to={`/users/${profileId}`}
              className="tw:text-inherit tw:no-underline tw:hover:underline"
            >
              {name}
            </Link>
          ) : (
            name
          )}
        </div>
        <div className="tw:truncate tw:text-[13px] tw:text-muted-foreground">
          {person.position || "—"}
          {inactive && <span className="tw:text-faint"> · отключён</span>}
        </div>
      </div>
      <div className="tw:flex tw:flex-none tw:items-center tw:gap-0.5">
        {person.email && (
          <a
            href={`mailto:${person.email}`}
            title={person.email}
            aria-label={`Написать — ${name}`}
            className={iconLinkClass}
          >
            <RiMailLine size={16} />
          </a>
        )}
        {person.phone && (
          <a
            href={`tel:${person.phone}`}
            title={person.phone}
            aria-label={`Позвонить — ${name}`}
            className={iconLinkClass}
          >
            <RiPhoneLine size={16} />
          </a>
        )}
      </div>
    </div>
  );
};

const Group = ({ title, people }) => (
  <>
    <SubLabel count={people?.length || undefined}>{title}</SubLabel>
    {people && people.length > 0 ? (
      <div className="tw:mb-1">
        {people.map((person) => (
          <PersonRow key={person._id || person.id} person={person} />
        ))}
      </div>
    ) : (
      <div className="tw:mb-1 tw:pb-1 tw:text-sm tw:text-muted-foreground">
        Не указаны
      </div>
    )}
  </>
);

const ResponsiblesSection = ({ company, id }) => (
  <>
    <Eyebrow id={id}>Ответственные</Eyebrow>
    <Panel>
      <Group
        title="Со стороны клиента"
        people={company.clientsSideResponsibles}
      />
      <div className="tw:mt-4">
        <Group title="Со стороны исполнителя" people={company.responsibles} />
      </div>
    </Panel>
  </>
);

export default ResponsiblesSection;
