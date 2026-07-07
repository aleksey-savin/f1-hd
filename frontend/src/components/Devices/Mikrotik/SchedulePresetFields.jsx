import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";

const FREQUENCY_OPTIONS = [
  { value: "off", label: "Выключено" },
  { value: "daily", label: "Ежедневно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "monthly", label: "Ежемесячно" },
];

// Monday-first; values follow JS getDay() (0 = Sunday) to match the backend.
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Понедельник" },
  { value: 2, label: "Вторник" },
  { value: 3, label: "Среда" },
  { value: 4, label: "Четверг" },
  { value: 5, label: "Пятница" },
  { value: 6, label: "Суббота" },
  { value: 0, label: "Воскресенье" },
];

const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, index) => index + 1);

// Friendly preset schedule editor (a controlled sub-form). `value` is the
// schedule object; `onChange` receives the updated object. A settings panel, so
// it uses the native Form.Select per the UI guide.
const SchedulePresetFields = ({ value, onChange, disabled = false }) => {
  const set = (patch) => onChange({ ...value, ...patch });
  const isOff = value.frequency === "off";

  return (
    <>
      <Row className="g-2">
        <Col xs={12}>
          <Form.Label htmlFor="frequency" className="small mb-1">
            Периодичность
          </Form.Label>
          <Form.Select
            id="frequency"
            value={value.frequency}
            disabled={disabled}
            onChange={(event) => set({ frequency: event.target.value })}
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Form.Select>
        </Col>

        {!isOff && (
          <>
            <Col xs={6}>
              <Form.Label htmlFor="time" className="small mb-1">
                Время
              </Form.Label>
              <Form.Control
                id="time"
                type="time"
                value={value.time}
                disabled={disabled}
                onChange={(event) => set({ time: event.target.value })}
              />
            </Col>

            {value.frequency === "weekly" && (
              <Col xs={6}>
                <Form.Label htmlFor="weekday" className="small mb-1">
                  День недели
                </Form.Label>
                <Form.Select
                  id="weekday"
                  value={value.weekday}
                  disabled={disabled}
                  onChange={(event) =>
                    set({ weekday: Number(event.target.value) })
                  }
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            )}

            {value.frequency === "monthly" && (
              <Col xs={6}>
                <Form.Label htmlFor="dayOfMonth" className="small mb-1">
                  День месяца
                </Form.Label>
                <Form.Select
                  id="dayOfMonth"
                  value={value.dayOfMonth}
                  disabled={disabled}
                  onChange={(event) =>
                    set({ dayOfMonth: Number(event.target.value) })
                  }
                >
                  {DAYS_OF_MONTH.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            )}

            <Col xs={6}>
              <Form.Label htmlFor="keepLast" className="small mb-1">
                Хранить копий
              </Form.Label>
              <Form.Control
                id="keepLast"
                type="number"
                min={1}
                max={365}
                value={value.keepLast}
                disabled={disabled}
                onChange={(event) =>
                  set({ keepLast: Number(event.target.value) })
                }
              />
            </Col>
          </>
        )}
      </Row>

      {!isOff && (
        <Form.Text className="text-muted d-block mt-2">
          Старые копии сверх выбранного количества удаляются автоматически после
          успешного создания.
        </Form.Text>
      )}
    </>
  );
};

export default SchedulePresetFields;
