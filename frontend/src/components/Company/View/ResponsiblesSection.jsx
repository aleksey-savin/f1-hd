import { Link } from "react-router";
import { RiMailLine, RiPhoneLine } from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
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
  "grid size-8 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-faint no-underline transition-colors hover:bg-border-soft hover:text-foreground";

const PersonRow = ({ person, from }) => {
  const name = getFullName(person);
  const inactive = person.isActive === false;
  const profileId = person.id?._id || person.id;

  return (
    <div className="flex items-center gap-3 border-t border-border-soft py-2.5 first:border-t-0">
      <span
        aria-hidden
        className={cn(
          "grid size-9 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border",
          inactive && "opacity-60",
        )}
      >
        {monogramFor(name)}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm leading-tight font-medium",
            inactive && "text-muted-foreground",
          )}
        >
          {profileId ? (
            <Link
              to={`/users/${profileId}`}
              state={useCrumbFrom(from)}
              className="text-inherit no-underline hover:underline"
            >
              {name}
            </Link>
          ) : (
            name
          )}
        </div>
        <div className="truncate text-sm text-muted-foreground">
          {person.position || "—"}
          {inactive && <span className="text-faint"> · отключён</span>}
        </div>
      </div>
      <div className="flex flex-none items-center gap-0.5">
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

const Group = ({ title, people, from }) => (
  <>
    <SubLabel count={people?.length || undefined}>{title}</SubLabel>
    {people && people.length > 0 ? (
      <div className="mb-1">
        {people.map((person) => (
          <PersonRow from={from} key={person._id || person.id} person={person} />
        ))}
      </div>
    ) : (
      <div className="mb-1 pb-1 text-sm text-muted-foreground">Не указаны</div>
    )}
  </>
);

const ResponsiblesSection = ({ company, id }) => (
  <>
    <Eyebrow id={id}>Ответственные</Eyebrow>
    <Panel>
      <Group from={company.alias}
        title="Со стороны клиента"
        people={company.clientsSideResponsibles}
      />
      <div className="mt-4">
        <Group from={company.alias} title="Со стороны исполнителя" people={company.responsibles} />
      </div>
    </Panel>
  </>
);

export default ResponsiblesSection;
