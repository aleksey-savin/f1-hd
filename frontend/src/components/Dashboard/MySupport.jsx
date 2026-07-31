import { useEffect, useState } from "react";

import { RiMailLine, RiPhoneLine } from "react-icons/ri";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import useInitialPrefsStore from "../../store/prefs";
import { getLocalStorageData } from "../../util/auth";
import { monogramFor } from "@/components/app/monogram";

/**
 * «Кто ведёт вашу компанию» — наши инженеры с прямыми контактами.
 *
 * Кому. Только ответственному со стороны клиента и руководителю подразделения
 * (решает бэкенд, `GET /companies/my-support`): рядовой сотрудник клиента
 * пишет заявку и не выбирает, кого дёргать, а эти двое как раз эскалируют.
 *
 * Строка — язык адресной книги: круглая монограмма, имя, должность и каналы,
 * которые реально заполнены. Кнопки на пустой телефон не рисуем — контакт, по
 * которому не дозвониться, хуже отсутствия контакта.
 */
const MySupport = () => {
  const [data, setData] = useState(null);
  const contacts = useInitialPrefsStore((state) => state.contacts);

  useEffect(() => {
    const load = async () => {
      const { token } = getLocalStorageData();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies/my-support`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) throw new Error(`my-support ${response.status}`);
        setData(await response.json());
      } catch (error) {
        console.error("Не удалось загрузить контакты поддержки:", error);
      }
    };
    load();
  }, []);

  if (!data?.eligible) return null;

  const people = data.responsibles ?? [];
  const supportPhone = contacts?.tel || data.company?.phones?.[0] || "";
  const supportEmail = contacts?.email || "";
  if (people.length === 0 && !supportPhone && !supportEmail) return null;

  return (
    <section>
      <Eyebrow>Кто ведёт вашу компанию</Eyebrow>
      <Panel>
        <div className="tw:-mx-5 tw:-my-5">
          {people.map((person) => {
            const name = `${person.firstName} ${person.lastName}`.trim();
            return (
              <div
                key={person._id || person.email || name}
                className="tw:flex tw:items-center tw:gap-3 tw:border-b tw:border-border-soft tw:px-5 tw:py-3 tw:last:border-b-0"
              >
                <span className="tw:flex tw:size-9 tw:flex-none tw:items-center tw:justify-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border-soft">
                  {monogramFor(name)}
                </span>
                <span className="tw:min-w-0 tw:flex-1">
                  <span className="tw:block tw:truncate tw:text-sm tw:font-semibold">
                    {name || "—"}
                  </span>
                  <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground">
                    {person.position || "—"}
                  </span>
                </span>
                <span className="tw:flex tw:flex-none tw:gap-1">
                  {person.phone && (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-xs"
                      className="tw:text-muted-foreground"
                    >
                      <a href={`tel:${person.phone}`} aria-label={`Позвонить: ${name}`}>
                        <RiPhoneLine />
                      </a>
                    </Button>
                  )}
                  {person.email && (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-xs"
                      className="tw:text-muted-foreground"
                    >
                      <a href={`mailto:${person.email}`} aria-label={`Написать: ${name}`}>
                        <RiMailLine />
                      </a>
                    </Button>
                  )}
                </span>
              </div>
            );
          })}

          {(supportPhone || supportEmail) && (
            <div className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:px-5 tw:py-3">
              <span className="tw:flex tw:size-9 tw:flex-none tw:items-center tw:justify-center tw:rounded-full tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border-soft">
                <RiPhoneLine size={15} aria-hidden />
              </span>
              <span className="tw:min-w-0 tw:flex-1">
                <span className="tw:block tw:truncate tw:text-sm tw:font-semibold">
                  {supportPhone || supportEmail}
                </span>
                <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground">
                  Общая линия поддержки
                  {supportPhone && supportEmail ? ` · ${supportEmail}` : ""}
                </span>
              </span>
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
};

export default MySupport;
