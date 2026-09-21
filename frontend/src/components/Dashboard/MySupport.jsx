import { useEffect, useState } from "react";

import { RiPhoneLine } from "react-icons/ri";

import { Eyebrow, Panel } from "@/components/app/Panel";
import useInitialPrefsStore from "../../store/prefs";
import { monogramFor } from "@/components/app/monogram";

/**
 * «Кто ведёт вашу компанию» — наши инженеры: имя и должность, БЕЗ личных
 * контактов.
 *
 * Клиент не пишет и не звонит сотруднику лично (решение владельца 2026-09-21):
 * связь с нами — заявка или общая линия поддержки, она и стоит последней
 * строкой. Кнопок «позвонить» и «написать» у человека поэтому нет, а сервер
 * его почту и телефон клиенту не отдаёт вовсе (middleware/hideStaffContacts).
 *
 * Кому. Только ответственному со стороны клиента и руководителю подразделения
 * (решает бэкенд, `GET /companies/my-support`): рядовой сотрудник клиента
 * пишет заявку и не выбирает, кого дёргать, а эти двое как раз эскалируют.
 */
const MySupport = () => {
  const [data, setData] = useState(null);
  const contacts = useInitialPrefsStore((state) => state.contacts);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies/my-support`,
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
        <div className="-mx-5 -my-5">
          {people.map((person) => {
            const name = `${person.firstName} ${person.lastName}`.trim();
            return (
              <div
                key={person._id || name}
                className="flex items-center gap-3 border-b border-border-soft px-5 py-3 last:border-b-0"
              >
                <span className="flex size-9 flex-none items-center justify-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border-soft">
                  {monogramFor(name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {name || "—"}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {person.position || "—"}
                  </span>
                </span>
              </div>
            );
          })}

          {(supportPhone || supportEmail) && (
            <div className="flex items-center gap-3 border-t border-border-soft px-5 py-3">
              <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border-soft">
                <RiPhoneLine size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {supportPhone || supportEmail}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
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
