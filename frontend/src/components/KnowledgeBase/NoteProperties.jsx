import Select from "../../UI/Select";
import { NOTE_TYPES, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";
import { bindingLabel } from "../../util/knowledgeNoteBindings";
import { BindingPillList, EmptyPill, TypePill } from "./BindingPills";

const Label = ({ children }) => (
  <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
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
  const multi = {
    closeMenuOnSelect: false,
    isClearable: true,
    isSearchable: true,
    isMulti: true,
  };

  return (
    <div className="tw:mt-4">
      <div
        className="tw:flex tw:min-h-16 tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-2 tw:py-3"
        style={{
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Label>Тип</Label>
        {isEditing ? (
          <div className="tw:w-48">
            <Select
              aria-label="Тип заметки"
              placeholder="Тип"
              isSearchable={false}
              value={getNoteTypeMeta(type)}
              options={NOTE_TYPES}
              getOptionLabel={(option) => option.label}
              getOptionValue={(option) => option.value}
              onChange={(selected) => onTypeChange(selected?.value || "info")}
            />
          </div>
        ) : (
          <TypePill type={type} />
        )}

        <Label>Привязки</Label>
        {isEditing ? (
          <>
            <div className="tw:min-w-52 tw:flex-1">
              <Select
                {...multi}
                aria-label="Компании"
                placeholder="Компании"
                value={companies}
                options={formData.companies || []}
                getOptionLabel={(option) => bindingLabel("company", option)}
                getOptionValue={(option) => option._id}
                onChange={(selected) => onCompaniesChange(selected || [])}
              />
            </div>
            <div className="tw:min-w-52 tw:flex-1">
              <Select
                {...multi}
                aria-label="Категории заявок"
                placeholder="Категории заявок"
                value={categories}
                options={formData.categories || []}
                getOptionLabel={(option) => bindingLabel("category", option)}
                getOptionValue={(option) => option._id}
                onChange={(selected) => onCategoriesChange(selected || [])}
              />
            </div>
            <div className="tw:min-w-52 tw:flex-1">
              <Select
                {...multi}
                aria-label="Пользователи"
                placeholder="Пользователи"
                value={users}
                options={formData.users || []}
                getOptionLabel={(option) => bindingLabel("user", option)}
                getOptionValue={(option) => option._id}
                onChange={(selected) => onUsersChange(selected || [])}
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
        <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          Привязки определяют, кто видит заметку и в каких заявках она появится.
          Заметка без привязок видна всем сотрудникам.
        </p>
      )}
    </div>
  );
};

export default NoteProperties;
