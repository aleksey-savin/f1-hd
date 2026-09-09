import { useMemo, useState } from "react";

import { useLoaderData } from "react-router";
import { BrowserView } from "react-device-detect";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AnchorRail from "@/components/app/AnchorRail";
import ChipCombobox from "@/components/app/ChipCombobox";
import Field from "@/components/app/Field";
import { FormHeader } from "@/components/app/FormLayout";
import FormWrapper from "@/components/app/FormWrapper";
import Segmented from "@/components/app/Segmented";
import PermissionModules, {
  permissionGroupAnchor,
} from "@/components/User/PermissionModules";
import {
  usePermissionCatalogue,
  usePermissionLabels,
  useCan,
} from "@/store/authed-user";

/**
 * Форма роли.
 *
 * Собрана под главный сценарий — открыть готовую роль и добавить одно право;
 * создание с нуля бывает много реже. Отсюда три вещи, которых нет в обычной
 * форме: носители под названием, счётчики «N из M» в шапках карточек как
 * навигация по полусотне прав и блок «что изменится» перед кнопкой.
 *
 * Всё остальное — общее (по согласованному макету «Правка роли»): оболочка
 * `app/FormWrapper` с липкой шапкой `FormHeader`, поля `app/Field`, матрица
 * прав `User/PermissionModules` — та же, что в форме человека, — и рейл-якорь
 * по её группам: четырнадцать групп и полсотни строк листать вслепую не надо.
 * Под рейл шторка расширена до `xl` (см. ux-ui-guide, «Формы → нижняя
 * шторка»).
 */

/** Якорь первой секции — поля самой роли; дальше рейл ведёт по группам прав. */
const BASIC_ANCHOR = "role-basic";

const peopleWord = (count) => {
  const tail = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  if (!teen && tail === 1) return "человека";
  return "человек";
};

/** Носители роли: пока их немного — поимённо, дальше только число. */
const Bearers = ({ usage }) => {
  const total = usage?.total || 0;
  if (!total) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-accent/45 px-3 py-2.5 text-sm">
      <span className="font-semibold tabular-nums">
        {total} {peopleWord(total)}
      </span>
      {usage.names?.length ? (
        <span className="min-w-0 truncate text-muted-foreground">
          · {usage.names.join(", ")}
          {total > usage.names.length && " и другие"}
        </span>
      ) : null}
    </div>
  );
};

const RoleForm = ({ role }) => {
  // Каталог ролей приезжает лоадером создания — из него берётся заготовка
  // «Из роли»; у правки его нет, и контрол там не рисуется
  const { roles: catalogue = [] } = useLoaderData() ?? {};
  const groups = usePermissionCatalogue();
  const labels = usePermissionLabels();
  const can = useCan();
  // Липкая шапка формы: под неё прижимается рейл
  const [headHeight, setHeadHeight] = useState(0);
  const label = (id) => labels[id]?.label ?? id;

  // Что можно выдать: только то, что есть у самого. Спрашиваем `can()` по
  // каждому действию каталога — тот же вопрос, что задаст сервер
  // (`assertNotEscalating`), и потому тот же ответ.
  const allowed = useMemo(() => {
    const set = new Set();
    for (const id of Object.keys(labels)) {
      const [resource, action] = id.split(".");
      if (can({ [resource]: [action] })) set.add(id);
    }
    return set;
  }, [labels, can]);

  const initial = useMemo(() => new Set(role?.actions || []), [role]);
  const [title, setTitle] = useState(role?.title || "");
  const [description, setDescription] = useState(role?.description || "");
  // Новая роль по умолчанию сотруднику: клиентских ролей в каталоге три, и
  // заводят их редко.
  const [audience, setAudience] = useState(role?.audience || "staff");
  const [actions, setActions] = useState(() => new Set(role?.actions || []));
  const [sourceKey, setSourceKey] = useState(null);

  /**
   * Старт «из роли»: галочки выбранной роли ложатся в матрицу заготовкой —
   * связи между ролями не возникает, дальше правится как обычно (идиома «Из
   * шаблона» у новой заявки). Права, которых нет у самого, не копируются:
   * сервер их всё равно отобьёт, а в матрице они стоят погашенными.
   * Снятый выбор ничего не сбрасывает — к этому моменту галочки уже правили
   * руками, и обнулять их было бы потерей работы.
   */
  const pickSource = (key) => {
    setSourceKey(key);
    const source = key ? catalogue.find((item) => item.key === key) : null;
    if (!source) return;
    setActions(new Set((source.actions || []).filter((id) => allowed.has(id))));
  };

  const toggle = (id) =>
    setActions((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Что изменится против сохранённого состояния. Считается от исходной роли,
  // а не от пустоты: при создании блок не рисуется вовсе.
  const diff = useMemo(() => {
    if (!role) return { added: [], removed: [] };
    const added = [...actions].filter((id) => !initial.has(id));
    const removed = [...initial].filter((id) => !actions.has(id));
    return { added, removed };
  }, [role, initial, actions]);

  const changed = diff.added.length > 0 || diff.removed.length > 0;
  const total = role?.usage?.total || 0;

  const railSections = [
    { id: BASIC_ANCHOR, label: "Основное" },
    ...groups.map((group) => ({
      id: permissionGroupAnchor(group.key),
      label: group.label,
    })),
  ];

  const heading = role ? "Изменить роль" : "Новая роль";

  return (
    <FormWrapper
      title={heading}
      header={
        /* Заголовок — действием, название роли подзаголовком: как в правке
           человека («Изменить пользователя» · «Фамилия Имя · Компания») */
        <FormHeader
          title={heading}
          subtitle={role?.title}
          onHeight={setHeadHeight}
        >
          {!role && catalogue.length > 0 && (
            <ChipCombobox
              placeholder="Из роли"
              allLabel="Без шаблона"
              searchPlaceholder="Найти роль…"
              emptyText="Роль не нашлась."
              value={sourceKey}
              options={catalogue.map((item) => ({
                value: item.key,
                label: item.title,
              }))}
              onChange={pickSource}
            />
          )}
        </FormHeader>
      }
      json={() => ({ title, description, actions: [...actions], audience })}
      submitDisabled={!title.trim()}
    >
      <div className="flex items-start gap-7">
        {/* Рейл ведёт по группам прав: якорь вешает карточка группы, а список
            собирается из того же каталога — как рейл карточки компании. На
            мобайле его нет, карточки идут подряд */}
        <BrowserView className="contents">
          <AnchorRail
            sections={railSections}
            ariaLabel="Разделы формы роли"
            offset={headHeight + 24}
            style={{ top: headHeight }}
          />
        </BrowserView>

        <div className="min-w-0 flex-1">
          <div id={BASIC_ANCHOR}>
            {/* У новой роли носителей нет — пустая плашка «0 человек» была бы
                шумом на самом видном месте. */}
            {role && <Bearers usage={role.usage} />}

            <Field
              label="Название"
              htmlFor="role-title"
              required
              hint={
                role
                  ? "Меняется свободно: у роли есть неизменяемый ключ, по которому живут назначения"
                  : "Ключ роли соберётся из названия — потом название меняется свободно, ключ остаётся"
              }
            >
              <Input
                id="role-title"
                autoFocus
                placeholder="Например, «Инженер выездной»"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field label="Описание" htmlFor="role-description">
              <Textarea
                id="role-description"
                rows={2}
                placeholder="Зачем эта роль — увидят те, кто будет её назначать"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>

            <Field
              label="Кому назначается"
              hint="Определяет, кому роль предлагают в первую очередь. Выбрать её можно и для другого типа аккаунта."
            >
              <Segmented
                ariaLabel="Кому назначается"
                value={audience}
                onChange={setAudience}
                options={[
                  { value: "staff", label: "Сотрудникам" },
                  { value: "client", label: "Клиентам" },
                ]}
              />
            </Field>
          </div>

          <PermissionModules
            value={actions}
            onToggle={toggle}
            // Право, которого нет у самого, выдать нельзя — сервер отобьёт.
            // Предлагать то, что вернётся отказом, хуже, чем не предлагать.
            allowed={allowed}
          />

          {/* Последствие названо ДО нажатия: сообщение после сохранения
              приходит, когда менять что-то поздно. */}
          {changed && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="bg-accent/45 px-3 py-2 text-xs font-semibold tracking-wider text-faint uppercase">
                Что изменится
              </div>
              <div className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
                {diff.added.map((key) => (
                  <div key={key} className="font-semibold text-accent-text">
                    + {label(key)}
                  </div>
                ))}
                {diff.removed.map((key) => (
                  <div key={key} className="font-semibold text-destructive">
                    − {label(key)}
                  </div>
                ))}
                <div className="text-muted-foreground">
                  {total
                    ? `Затронет ${total} ${peopleWord(total)} — сразу, без перезахода.`
                    : "Роль никому не назначена — на людей это пока не влияет."}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </FormWrapper>
  );
};

export default RoleForm;
