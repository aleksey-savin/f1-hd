import { useEffect, useState } from "react";

import Form from "react-bootstrap/Form";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";

// Normalize defaults so an old prefs doc without the section doesn't crash and the
// section is always submitted back (the page POSTs the whole prefs object).
const ensureDefaults = (prefs) => {
  if (!prefs.mikrotik) prefs.mikrotik = {};
  if (!prefs.mikrotik.offlineTicket)
    prefs.mikrotik.offlineTicket = {
      isActive: false,
      thresholdMinutes: 15,
      categoryId: null,
    };
  if (!prefs.mikrotik.configChangeTicket)
    prefs.mikrotik.configChangeTicket = { isActive: false, categoryId: null };
  if (!prefs.mikrotik.securityUpdateTicket)
    prefs.mikrotik.securityUpdateTicket = {
      isActive: false,
      categoryId: null,
      minSeverity: "high",
    };
};

// Global Mikrotik settings: auto-tickets for monitoring events. Follows the
// settings-panel pattern (switch enables the block, fields below go disabled).
// State mirrors the shared `prefs` object, which is mutated by reference and saved
// with everything else by the parent's single "Сохранить" button.
const PrefsMikrotik = ({ prefs }) => {
  ensureDefaults(prefs);

  const [offlineActive, setOfflineActive] = useState(
    prefs.mikrotik.offlineTicket.isActive,
  );
  const [threshold, setThreshold] = useState(
    prefs.mikrotik.offlineTicket.thresholdMinutes,
  );
  const [offlineCategory, setOfflineCategory] = useState(
    prefs.mikrotik.offlineTicket.categoryId || null,
  );

  const [configActive, setConfigActive] = useState(
    prefs.mikrotik.configChangeTicket.isActive,
  );
  const [configCategory, setConfigCategory] = useState(
    prefs.mikrotik.configChangeTicket.categoryId || null,
  );

  const [securityActive, setSecurityActive] = useState(
    prefs.mikrotik.securityUpdateTicket.isActive,
  );
  const [securitySeverity, setSecuritySeverity] = useState(
    prefs.mikrotik.securityUpdateTicket.minSeverity || "high",
  );
  const [securityCategory, setSecurityCategory] = useState(
    prefs.mikrotik.securityUpdateTicket.categoryId || null,
  );

  const [categories, setCategories] = useState([]);

  useEffect(() => {
    const { token } = getLocalStorageData();
    fetch(`${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) =>
        setCategories(
          (Array.isArray(data) ? data : []).map((c) => ({
            value: c._id,
            label: c.title,
          })),
        ),
      )
      .catch(() => setCategories([]));
  }, []);

  const findOption = (value) =>
    categories.find((option) => option.value === value) || null;

  const toggleOffline = (event) => {
    setOfflineActive(event.target.checked);
    prefs.mikrotik.offlineTicket.isActive = event.target.checked;
  };
  const changeThreshold = (event) => {
    setThreshold(event.target.value);
    prefs.mikrotik.offlineTicket.thresholdMinutes = Number(event.target.value);
  };
  const selectOfflineCategory = (option) => {
    setOfflineCategory(option ? option.value : null);
    prefs.mikrotik.offlineTicket.categoryId = option ? option.value : null;
  };

  const toggleConfig = (event) => {
    setConfigActive(event.target.checked);
    prefs.mikrotik.configChangeTicket.isActive = event.target.checked;
  };
  const selectConfigCategory = (option) => {
    setConfigCategory(option ? option.value : null);
    prefs.mikrotik.configChangeTicket.categoryId = option ? option.value : null;
  };

  const toggleSecurity = (event) => {
    setSecurityActive(event.target.checked);
    prefs.mikrotik.securityUpdateTicket.isActive = event.target.checked;
  };
  const changeSecuritySeverity = (event) => {
    setSecuritySeverity(event.target.value);
    prefs.mikrotik.securityUpdateTicket.minSeverity = event.target.value;
  };
  const selectSecurityCategory = (option) => {
    setSecurityCategory(option ? option.value : null);
    prefs.mikrotik.securityUpdateTicket.categoryId = option
      ? option.value
      : null;
  };

  return (
    <>
      <h4>Устройства Mikrotik</h4>
      <p className="text-muted small mb-4">
        Автоматические заявки по событиям мониторинга управляемых устройств.
        Автор заявки — пользователь по умолчанию (раздел «Основные»), компания
        берётся из устройства.
      </p>

      <h5>Устройство недоступно</h5>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          id="mikrotik-offline-active"
          label="Создавать заявку, если устройство офлайн дольше порога"
          checked={offlineActive}
          onChange={toggleOffline}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Порог, минут</Form.Label>
        <Form.Control
          type="number"
          min={1}
          value={threshold}
          onChange={changeThreshold}
          disabled={!offlineActive}
        />
        <Form.Text className="text-muted">
          Одна заявка на эпизод недоступности; при восстановлении связи заявка
          остаётся открытой.
        </Form.Text>
      </Form.Group>
      <Form.Group className="mb-4">
        <Form.Label>Категория заявки (необязательно)</Form.Label>
        <Select
          isClearable
          placeholder="Без категории"
          options={categories}
          value={findOption(offlineCategory)}
          onChange={selectOfflineCategory}
          isDisabled={!offlineActive}
        />
      </Form.Group>

      <h5 className="mt-4">Изменение конфигурации</h5>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          id="mikrotik-config-active"
          label="Создавать заявку при изменении конфигурации между экспортами"
          checked={configActive}
          onChange={toggleConfig}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Категория заявки (необязательно)</Form.Label>
        <Select
          isClearable
          placeholder="Без категории"
          options={categories}
          value={findOption(configCategory)}
          onChange={selectConfigCategory}
          isDisabled={!configActive}
        />
        <Form.Text className="text-muted">
          Сравниваются последовательные .rsc-экспорты — настройте расписание
          экспорта у устройства.
        </Form.Text>
      </Form.Group>

      <h5 className="mt-4">Уязвимости прошивки</h5>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          id="mikrotik-security-active"
          label="Создавать заявку при критических уязвимостях прошивки"
          checked={securityActive}
          onChange={toggleSecurity}
        />
        <Form.Text className="text-muted">
          Одна заявка на все устройства в опасности, с чек-листом по устройству.
          Пункты отмечаются автоматически по мере обновления устройств; если
          заявку удалить или закрыть при сохраняющейся угрозе — она будет
          создана заново при следующей ежедневной проверке. Источник данных —
          NVD (nvd.nist.gov).
        </Form.Text>
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Минимальная опасность</Form.Label>
        <Form.Select
          value={securitySeverity}
          onChange={changeSecuritySeverity}
          disabled={!securityActive}
        >
          <option value="high">Высокие и критические (CVSS ≥ 7)</option>
          <option value="critical">Только критические (CVSS ≥ 9)</option>
        </Form.Select>
        <Form.Text className="text-muted">
          Порог общий: он же управляет красным индикатором уязвимости в таблице
          устройств.
        </Form.Text>
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Категория заявки (необязательно)</Form.Label>
        <Select
          isClearable
          placeholder="Без категории"
          options={categories}
          value={findOption(securityCategory)}
          onChange={selectSecurityCategory}
          isDisabled={!securityActive}
        />
      </Form.Group>
    </>
  );
};

export default PrefsMikrotik;
