import Table from "react-bootstrap/Table";
import Form from "react-bootstrap/Form";

const dash = <span className="text-body-secondary">—</span>;

// Таблица расхождений «в карточке ↔ на устройстве». Синхронизируемые поля
// выбираются галочками; несинхронизируемые (модель/плата) показываются как
// «только сверка». selected — Set имён полей; onToggle(field) переключает выбор.
const ReconciliationTable = ({ mismatches = [], selected, onToggle }) => (
  <Table responsive size="sm" className="align-middle mb-0">
    <thead>
      <tr className="text-body-secondary">
        <th style={{ width: 32 }} aria-label="Выбрать" />
        <th>Поле</th>
        <th>В карточке</th>
        <th>На устройстве</th>
      </tr>
    </thead>
    <tbody>
      {mismatches.map((item) => (
        <tr
          key={item.field}
          className={item.syncable ? "" : "text-body-secondary"}
        >
          <td>
            {item.syncable && (
              <Form.Check
                type="checkbox"
                id={`reconcile-${item.field}`}
                checked={selected?.has(item.field) || false}
                onChange={() => onToggle?.(item.field)}
                aria-label={`Обновить: ${item.label}`}
              />
            )}
          </td>
          <td>
            {item.label}
            {!item.syncable && (
              <div className="small text-body-secondary">только сверка</div>
            )}
          </td>
          <td className="font-monospace text-break">
            {item.cardValue || dash}
          </td>
          <td className="font-monospace text-break">
            {item.deviceValue || dash}
            {item.deviceValues && item.deviceValues.length > 1 && (
              <div className="small text-body-secondary font-monospace">
                {item.deviceValues.join(" · ")}
              </div>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </Table>
);

export default ReconciliationTable;
