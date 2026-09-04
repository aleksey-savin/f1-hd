import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiArrowRightSLine,
  RiGroupLine,
  RiMailLine,
  RiPhoneLine,
} from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import SearchBar from "@/components/app/SearchBar";
import ChipSelect from "@/components/app/ChipSelect";
import { cn } from "@/lib/utils";

import useUserFilterStore from "../../../store/lists/users";
import UserAvatar from "../../User/UserAvatar";
import UserContactSheet from "../../User/ContactSheet";
import { relativeDay } from "../../../util/relative-time";

// Сотрудники компании — адресная книга, а не таблица: поиск, чип-фасет по
// подразделению, строки-люди. Свёрнута до COLLAPSED_ROWS строк (при активном
// поиске/фасете показывается всё найденное); «Все сотрудники (N) →» уводит в
// раздел «Пользователи» с предустановленным фильтром компании. Бэкенд отдаёт
// только активных — состояния «отключён» здесь не бывает.
const COLLAPSED_ROWS = 7;
const NO_SUBDIVISION = "__none__";

const iconLinkClass =
  "grid size-8 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-faint no-underline transition-colors hover:bg-border-soft hover:text-foreground";

const EmployeesSection = ({ company, id }) => {
  const fromState = useCrumbFrom(company.alias);
  const navigate = useNavigate();
  const employees = company.employees || [];

  const [searchQuery, setSearchQuery] = useState("");
  const [subdivisionFilter, setSubdivisionFilter] = useState(null);
  const [contactUser, setContactUser] = useState(null);

  const subdivisionOptions = useMemo(() => {
    const names = new Set();
    employees.forEach((user) => {
      if (user.subdivision?.name) names.add(user.subdivision.name);
    });
    const options = [...names]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((name) => ({ value: name, label: name }));
    if (employees.some((user) => !user.subdivision?.name)) {
      options.push({ value: NO_SUBDIVISION, label: "Без подразделения" });
    }
    return options;
  }, [employees]);

  const query = searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = [...employees].sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(
        `${b.lastName} ${b.firstName}`,
        "ru",
      ),
    );
    if (subdivisionFilter === NO_SUBDIVISION) {
      list = list.filter((user) => !user.subdivision?.name);
    } else if (subdivisionFilter) {
      list = list.filter(
        (user) => user.subdivision?.name === subdivisionFilter,
      );
    }
    if (query) {
      list = list.filter((user) =>
        [
          `${user.lastName} ${user.firstName}`,
          user.position,
          user.email,
          user.phone,
          user.subdivision?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }
    return list;
  }, [employees, subdivisionFilter, query]);

  // Свёрнутый хвост — только в «чистом» состоянии: активный запрос/фасет
  // показывает всё найденное, иначе поиск по свёрнутому списку бессмыслен.
  const hasActiveQuery = Boolean(query || subdivisionFilter);
  const visible = hasActiveQuery ? filtered : filtered.slice(0, COLLAPSED_ROWS);

  // «Все сотрудники →» — раздел «Пользователи», выборка уже сужена до этой
  // компании (стор списка), сам fetch сделает монтирование страницы.
  const openAllUsers = () => {
    useUserFilterStore.setState({
      audience: "clients",
      company: company._id,
      searchTerm: "",
      page: 1,
    });
    navigate("/users", { state: fromState });
  };

  const openRow = (user) => {
    if (isMobile) {
      setContactUser({
        ...user,
        isEndUser: true,
        company: { alias: company.alias },
        subdivisionName: user.subdivision?.name,
        companyAddress: company.address,
        companyMapLink: company.linkToMap,
        lastActivityAt: user.lastActivity?.date,
      });
    } else {
      navigate(`/users/${user._id}`, { state: fromState });
    }
  };

  return (
    <>
      <Eyebrow id={id} count={employees.length}>
        Сотрудники
      </Eyebrow>
      <Panel>
        {employees.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-6 text-center">
            <RiGroupLine size={36} aria-hidden className="text-faint" />
            <div className="font-semibold">Сотрудников пока нет</div>
            <p className="my-0 text-sm text-muted-foreground">
              Пользователи компании заводятся в разделе «Пользователи» — там же
              они привязываются к компании и подразделению.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SearchBar
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-72 max-md:w-full"
              />
              {subdivisionOptions.length > 1 && (
                <ChipSelect
                  placeholder="Подразделение"
                  allLabel="Все подразделения"
                  value={subdivisionFilter}
                  options={subdivisionOptions}
                  onChange={setSubdivisionFilter}
                />
              )}
            </div>

            {visible.length > 0 ? (
              <div>
                {visible.map((user) => {
                  const lastSeen = relativeDay(user.lastActivity?.date);
                  return (
                    <div
                      key={user._id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRow(user)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openRow(user);
                        }
                      }}
                      className="group flex cursor-pointer items-center gap-3 border-t border-border-soft py-2.5 transition-colors first:border-t-0 hover:bg-accent/60"
                    >
                      <UserAvatar
                        user={user}
                        sizeClass="size-9"
                        textClass="text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm leading-tight font-medium">
                          {user.lastName} {user.firstName}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {[user.position, user.subdivision?.name]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </div>
                      <div
                        className="hidden flex-none items-center gap-0.5 md:flex"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {user.email && (
                          <a
                            href={`mailto:${user.email}`}
                            title={user.email}
                            aria-label={`Написать — ${user.lastName} ${user.firstName}`}
                            className={iconLinkClass}
                          >
                            <RiMailLine size={16} />
                          </a>
                        )}
                        {user.phone && (
                          <a
                            href={`tel:${user.phone}`}
                            title={user.phone}
                            aria-label={`Позвонить — ${user.lastName} ${user.firstName}`}
                            className={iconLinkClass}
                          >
                            <RiPhoneLine size={16} />
                          </a>
                        )}
                      </div>
                      <span
                        title={
                          user.lastActivity?.ticketNum
                            ? `Последняя заявка №${user.lastActivity.ticketNum}`
                            : "Обращений не было"
                        }
                        className={cn(
                          "hidden w-24 flex-none text-right text-xs text-faint tabular-nums md:block",
                        )}
                      >
                        {lastSeen || "—"}
                      </span>
                      <RiArrowRightSLine
                        size={18}
                        aria-hidden
                        className="flex-none text-faint md:hidden"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-2 text-sm text-muted-foreground">
                Ничего не нашлось. Измените запрос или сбросьте фильтр.
              </div>
            )}

            <button
              type="button"
              onClick={openAllUsers}
              className="mt-3.5 inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text outline-none hover:underline"
            >
              Все сотрудники ({employees.length}) →
            </button>
          </>
        )}
      </Panel>

      <UserContactSheet
        item={contactUser}
        open={Boolean(contactUser)}
        onOpenChange={(open) => {
          if (!open) setContactUser(null);
        }}
      />
    </>
  );
};

export default EmployeesSection;
