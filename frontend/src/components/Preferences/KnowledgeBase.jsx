import { useEffect, useState } from "react";

import Form from "react-bootstrap/Form";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";

const defaultKnowledgeBase = {
  moderators: [],
  hideNotApproved: false,
  approvalPeriodDays: 0,
  scanForSecrets: false,
};

const PrefsKnowledgeBase = ({ prefs }) => {
  const { token } = getLocalStorageData();

  // Гарантируем наличие объекта настроек (на случай старого документа prefs)
  if (!prefs.knowledgeBase) {
    prefs.knowledgeBase = { ...defaultKnowledgeBase };
  }

  const [moderators, setModerators] = useState(
    prefs.knowledgeBase.moderators || [],
  );
  const [hideNotApproved, setHideNotApproved] = useState(
    prefs.knowledgeBase.hideNotApproved || false,
  );
  const [approvalPeriodDays, setApprovalPeriodDays] = useState(
    prefs.knowledgeBase.approvalPeriodDays || 0,
  );
  const [scanForSecrets, setScanForSecrets] = useState(
    prefs.knowledgeBase.scanForSecrets || false,
  );
  const [candidates, setCandidates] = useState([]);

  // Кандидаты в модераторы — сотрудники с правами «видеть» и «управлять» базой
  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/users/knowledge-base-moderators`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (response.ok) {
          setCandidates(await response.json());
        }
      } catch {
        // молча игнорируем — селект останется без опций
      }
    };
    fetchCandidates();
  }, [token]);

  const moderatorsChangeHandler = (selected) => {
    const next = (selected || []).map((user) => ({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
    }));
    setModerators(next);
    prefs.knowledgeBase.moderators = next;
  };

  const hideNotApprovedChangeHandler = () => {
    const next = !hideNotApproved;
    setHideNotApproved(next);
    prefs.knowledgeBase.hideNotApproved = next;
  };

  const scanForSecretsChangeHandler = () => {
    const next = !scanForSecrets;
    setScanForSecrets(next);
    prefs.knowledgeBase.scanForSecrets = next;
  };

  const approvalPeriodChangeHandler = (event) => {
    const value = Math.max(0, parseInt(event.target.value, 10) || 0);
    setApprovalPeriodDays(value);
    prefs.knowledgeBase.approvalPeriodDays = value;
  };

  return (
    <>
      <Form.Group className="mb-3">
        <Form.Label>Модераторы базы знаний</Form.Label>
        <Select
          isMulti
          closeMenuOnSelect={false}
          isClearable
          isSearchable
          placeholder="Выберите модераторов"
          value={moderators}
          options={candidates}
          getOptionLabel={(option) => `${option.lastName} ${option.firstName}`}
          getOptionValue={(option) => option._id}
          onChange={moderatorsChangeHandler}
        />
        <Form.Text muted>
          Доступны только сотрудники с правами «Видеть базу знаний» и «Управлять
          базой знаний».
        </Form.Text>
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Скрывать неодобренные заметки от обычных пользователей"
          checked={hideNotApproved}
          value={hideNotApproved}
          onChange={hideNotApprovedChangeHandler}
        />
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Срок действия одобрения, дней</Form.Label>
        <Form.Control
          type="number"
          min={0}
          value={approvalPeriodDays}
          onChange={approvalPeriodChangeHandler}
        />
        <Form.Text muted>
          Через столько дней одобренная заметка снова станет неодобренной. 0 — не
          сбрасывать.
        </Form.Text>
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Искать в заметках пароли, ключи шифрования, API-ключи и прочие чувствительные данные"
          checked={scanForSecrets}
          value={scanForSecrets}
          onChange={scanForSecretsChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default PrefsKnowledgeBase;
