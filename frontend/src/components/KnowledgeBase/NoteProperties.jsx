import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";
import { NOTE_TYPES } from "../../util/knowledgeNoteTypes";
import { bindingLabel } from "../../util/knowledgeNoteBindings";
import { BindingPillList, EmptyPill, TypePill } from "./BindingPills";

const Label = ({ children }) => (
  <span className="text-xs font-bold tracking-wider text-faint uppercase">
    {children}
  </span>
);

// Свойства заметки: тип и три вида привязок — одной тихой строкой под шапкой.
// На странице-документе главное содержимое, а не его метаданные, поэтому
// метаданные не отжимают текст вниз. Высота строки одинакова в чтении и правке
// (min-h под высоту селекта), поэтому при переключении режима текст не
// сдвигается. Подсказку о видимости показываем только в правке: в чтении она
// уже ничего не меняет.
const NoteProperties = ({
  isEditing,
  type,
  categories,
  companies,
  users,
  formData = {},
  onTypeChange,
  onCategoriesChange,
  onCompaniesChange,
  onUsersChange,
}) => {
  return (
    <div className="mt-4">
      <div
        className="flex min-h-16 flex-wrap items-center gap-x-2.5 gap-y-2 py-3"
        style={{
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Label>Тип</Label>
        {isEditing ? (
          <div className="w-48">
            <Combobox
              placeholder="Тип"
              value={type || null}
              options={NOTE_TYPES}
              onChange={(value) => onTypeChange(value || "info")}
            />
          </div>
        ) : (
          <TypePill type={type} />
        )}

        <Label>Привязки</Label>
        {isEditing ? (
          <>
            <div className="min-w-52 flex-1">
              <MultiCombobox
                ariaLabel="Компании"
                placeholder="Компании"
                value={(companies || []).map((item) => String(item._id))}
                options={toOptions(formData.companies || [], {
                  value: (option) => String(option._id),
                  label: (option) => bindingLabel("company", option),
                })}
                onChange={(ids) =>
                  onCompaniesChange(
                    (formData.companies || []).filter((option) =>
                      ids.includes(String(option._id)),
                    ),
                  )
                }
              />
            </div>
            <div className="min-w-52 flex-1">
              <MultiCombobox
                ariaLabel="Категории заявок"
                placeholder="Категории заявок"
                value={(categories || []).map((item) => String(item._id))}
                options={toOptions(formData.categories || [], {
                  value: (option) => String(option._id),
                  label: (option) => bindingLabel("category", option),
                })}
                onChange={(ids) =>
                  onCategoriesChange(
                    (formData.categories || []).filter((option) =>
                      ids.includes(String(option._id)),
                    ),
                  )
                }
              />
            </div>
            <div className="min-w-52 flex-1">
              <MultiCombobox
                ariaLabel="Пользователи"
                placeholder="Пользователи"
                value={(users || []).map((item) => String(item._id))}
                options={toOptions(formData.users || [], {
                  value: (option) => String(option._id),
                  label: (option) => bindingLabel("user", option),
                })}
                onChange={(ids) =>
                  onUsersChange(
                    (formData.users || []).filter((option) =>
                      ids.includes(String(option._id)),
                    ),
                  )
                }
              />
            </div>
          </>
        ) : (
          <>
            <BindingPillList kind="company" items={companies} />
            <BindingPillList kind="category" items={categories} />
            <BindingPillList kind="user" items={users} />
            {companies.length === 0 &&
              categories.length === 0 &&
              users.length === 0 && (
                <EmptyPill>Без привязок — видна всем сотрудникам</EmptyPill>
              )}
          </>
        )}
      </div>

      {isEditing && (
        <p className="mt-2 mb-0 text-sm text-muted-foreground">
          Привязки определяют, кто видит заметку и в каких заявках она появится.
          Заметка без привязок видна всем сотрудникам.
        </p>
      )}
    </div>
  );
};

export default NoteProperties;
