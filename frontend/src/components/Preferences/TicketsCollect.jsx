import { useState, useCallback, useEffect } from "react";

import useHttp from "../../hooks/use-http";

import Select from "react-select";
import Form from "react-bootstrap/Form";

import { getLocalStorageData } from "../../util/auth";

const PrefsTicketsCollect = (props) => {
  const { token } = getLocalStorageData();

  const [useEmail, setUseEmail] = useState(props.prefs.useEmail);
  const [emailAddress, setEmailAddress] = useState(props.prefs.emailAddress);
  const [emailPassword, setEmailPassword] = useState(props.prefs.emailPassword);
  const [imapServer, setImapServer] = useState(props.prefs.imapServer);

  const [defaultApplicant, setDefaultApplicant] = useState(
    props.prefs.defaultApplicant,
  );
  const [identifyCompany, setIdentifyCompany] = useState(
    props.prefs.identifyCompany,
  );
  const [identifyApplicant, setIdentifyApplicant] = useState(
    props.prefs.identifyApplicant,
  );
  const [checkPhoneNumber, setCheckPhoneNumber] = useState(
    props.prefs.checkPhoneNumber,
  );

  const useEmailChangeHandler = () => {
    setUseEmail(!useEmail);
    props.prefs.useEmail = !useEmail;
  };

  const emailAddressChangeHandler = (event) => {
    setEmailAddress(event.target.value);
    props.prefs.emailAddress = event.target.value;
  };

  const emailPasswordChangeHandler = (event) => {
    setEmailPassword(event.target.value);
    props.prefs.emailPassword = event.target.value;
  };

  const imapServerChangeHandler = (event) => {
    setImapServer(event.target.value);
    props.prefs.imapServer = event.target.value;
  };

  const defaultApplicantChangeHandler = (selectedItem) => {
    setDefaultApplicant(selectedItem);
    props.prefs.defaultApplicant = selectedItem;
    props.prefs.defaultCompany = selectedItem.company;
  };

  const identifyCompanyChangeHandler = () => {
    setIdentifyCompany(!identifyCompany);
    props.prefs.identifyCompany = !identifyCompany;
  };

  const identifyApplicantChangeHandler = () => {
    setIdentifyApplicant(!identifyApplicant);
    props.prefs.identifyApplicant = !identifyApplicant;
  };

  const checkPhoneNumberChangeHandler = () => {
    setCheckPhoneNumber(!checkPhoneNumber);
    props.prefs.checkPhoneNumber = !checkPhoneNumber;
  };

  const [usersList, setUsersList] = useState([]);
  const { sendRequest: fetchUsersHandler } = useHttp();

  const fetchServiceAccounts = useCallback(() => {
    fetchUsersHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/form-data/service-accounts`,
        headers: {
          Authorization: "Bearer " + token,
        },
      },
      (data) => {
        if (data) {
          setUsersList(data);
        }
      },
    );
  }, [fetchUsersHandler, token]);

  useEffect(() => {
    fetchServiceAccounts();
  }, [fetchServiceAccounts]);

  return (
    <>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Собирать заявки с почтового ящика"
          checked={useEmail}
          value={useEmail}
          onChange={useEmailChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Email</Form.Label>
        <Form.Control
          disabled={!useEmail}
          required
          type="email"
          value={emailAddress}
          onChange={emailAddressChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Пароль</Form.Label>
        <Form.Control
          disabled={!useEmail}
          required
          type="password"
          value={emailPassword}
          onChange={emailPasswordChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>IMAP Сервер</Form.Label>
        <Form.Control
          disabled={!useEmail}
          required
          type="text"
          value={imapServer}
          onChange={imapServerChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Инициатор по-умолчанию</Form.Label>
        <Select
          isDisabled={!useEmail}
          placeholder="Выберите пользователя"
          isClearable
          isSearchable
          options={usersList}
          value={defaultApplicant}
          getOptionLabel={(option) => `${option.lastName} ${option.firstName}`}
          getOptionValue={(option) => option._id}
          onChange={defaultApplicantChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Check
          disabled={!useEmail}
          type="switch"
          label="Определять компанию по почтовому домену"
          checked={identifyCompany}
          value={identifyCompany}
          onChange={identifyCompanyChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Check
          disabled={!useEmail}
          type="switch"
          label="Определять инициатора по почтовому адресу"
          checked={identifyApplicant}
          value={identifyApplicant}
          onChange={identifyApplicantChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Check
          disabled={!useEmail || !identifyApplicant || !identifyCompany}
          type="switch"
          label="Искать номер телефона в теме письма"
          checked={checkPhoneNumber}
          value={checkPhoneNumber}
          onChange={checkPhoneNumberChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default PrefsTicketsCollect;
