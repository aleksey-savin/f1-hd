import EntityLink from "@/components/app/EntityLink";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { useCan } from "@/store/authed-user";
import { createdTo } from "@/util/inventory-changes";

/**
 * Панель «Создано»: всё, что пакет создал, по порядку операций. Ссылкой —
 * только то, у чего есть страница и на что у человека есть право; удалённое
 * после применения сервер уже пропустил.
 */
const ChangeCreated = ({ created = [] }) => {
  const can = useCan();
  if (!created.length) return null;

  return (
    <>
      <Eyebrow count={created.length}>Создано</Eyebrow>
      <Panel>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {created.map((item) => {
            const to = createdTo(item, can);
            return (
              <li
                key={`${item.model}:${item.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2"
              >
                {to ? (
                  <EntityLink
                    to={to}
                    from="Предложение ИИ-агента"
                    className="min-w-0 text-accent-text no-underline wrap-anywhere hover:underline"
                  >
                    {item.label}
                  </EntityLink>
                ) : (
                  <span className="min-w-0 wrap-anywhere">{item.label}</span>
                )}
                {item.kindLabel && (
                  <span className="text-xs text-faint">{item.kindLabel}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
};

export default ChangeCreated;
