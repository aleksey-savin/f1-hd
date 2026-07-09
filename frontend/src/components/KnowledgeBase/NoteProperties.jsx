import Badge from "react-bootstrap/Badge";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";

import {
  RiPriceTag3Line,
  RiBuilding2Line,
  RiAccountBoxLine,
  RiBookmark3Line,
} from "react-icons/ri";

import Select from "../../UI/Select";
import { NOTE_TYPES, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";
import { BindingChipList, bindingLabel } from "./BindingChips";

import "../../UI/knowledgeBase.css";

const dash = <span className="text-body-secondary">—</span>;

// Строка свойства: подпись слева, значение справа. Высота значения фиксирована,
// поэтому пилюли в чтении и Select в правке занимают один и тот же бокс — при
// переключении режима текст заметки не сдвигается.
const PropertyRow = ({ icon, label, children }) => (
  <div className="kb-prop">
    <span className="kb-prop__label">
      {icon}
      {label}
    </span>
    <div className="kb-prop__value">{children}</div>
  </div>
);

// Пусто → прочерк, а не пустая строка.
const Chips = ({ kind, items }) =>
  items?.length ? <BindingChipList kind={kind} items={items} /> : dash;

// Свойства заметки: тип и три вида привязок. Блок компактный — на
// странице-документе главное содержимое, а не его метаданные. Подсказку о том,
// что привязки управляют видимостью, показываем только в правке: в чтении она
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
  const typeMeta = getNoteTypeMeta(type);

  return (
    <div className="kb-props mb-3">
      <Row className="g-0">
        <Col md={6}>
          <PropertyRow icon={<RiBookmark3Line />} label="Тип">
            {isEditing ? (
              <Select
                placeholder="Тип"
                isSearchable={false}
                value={typeMeta}
                options={NOTE_TYPES}
                getOptionLabel={(option) => option.label}
                getOptionValue={(option) => option.value}
                onChange={(selected) => onTypeChange(selected?.value || "info")}
              />
            ) : (
              <Badge bg={typeMeta.badge} className="fw-normal">
                {typeMeta.label}
              </Badge>
            )}
          </PropertyRow>
        </Col>

        <Col md={6}>
          <PropertyRow icon={<RiPriceTag3Line />} label="Категории">
            {isEditing ? (
              <Select
                placeholder="Категории заявок"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={categories}
                options={formData.categories || []}
                getOptionLabel={(option) => bindingLabel("category", option)}
                getOptionValue={(option) => option._id}
                onChange={(selected) => onCategoriesChange(selected || [])}
              />
            ) : (
              <Chips kind="category" items={categories} />
            )}
          </PropertyRow>
        </Col>

        <Col md={6}>
          <PropertyRow icon={<RiBuilding2Line />} label="Компании">
            {isEditing ? (
              <Select
                placeholder="Компании"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={companies}
                options={formData.companies || []}
                getOptionLabel={(option) => bindingLabel("company", option)}
                getOptionValue={(option) => option._id}
                onChange={(selected) => onCompaniesChange(selected || [])}
              />
            ) : (
              <Chips kind="company" items={companies} />
            )}
          </PropertyRow>
        </Col>

        <Col md={6}>
          <PropertyRow icon={<RiAccountBoxLine />} label="Пользователи">
            {isEditing ? (
              <Select
                placeholder="Пользователи"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={users}
                options={formData.users || []}
                getOptionLabel={(option) => bindingLabel("user", option)}
                getOptionValue={(option) => option._id}
                onChange={(selected) => onUsersChange(selected || [])}
              />
            ) : (
              <Chips kind="user" items={users} />
            )}
          </PropertyRow>
        </Col>
      </Row>

      {isEditing && (
        <Form.Text muted className="d-block mt-2">
          Привязки определяют, кто видит заметку и в каких заявках она появится.
          Заметка без привязок видна всем сотрудникам.
        </Form.Text>
      )}
    </div>
  );
};

export default NoteProperties;
