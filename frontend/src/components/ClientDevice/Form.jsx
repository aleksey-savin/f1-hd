import { useState, useEffect, useMemo } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Stack from "react-bootstrap/Stack";
import Container from "react-bootstrap/Container";
import Spinner from "react-bootstrap/Spinner";

import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiSaveLine,
  RiArrowGoBackFill,
  RiAddLine,
} from "react-icons/ri";

import Select from "../../UI/Select";
import AlertMessage from "../../UI/AlertMessage";
import useOffcanvasStore from "../../store/offcanvas";
import { getLocalStorageData } from "../../util/auth";

import WizardStepper from "./WizardStepper";
import PurchaseFields from "./PurchaseFields";
import TechFields from "./TechFields";
import InlineCreateModal from "./InlineCreateModal";

const STATUS_OPTIONS = [
  { value: "readyForDeployment", label: "Готово к выдаче" },
  { value: "deployed", label: "Выдано" },
  { value: "inRepair", label: "В ремонте" },
  { value: "inReserve", label: "В резерве" },
  { value: "decommissioned", label: "Выведено из эксплуатации" },
  { value: "disposed", label: "Утилизировано" },
];

const STEPS = [
  { label: "Компания" },
  { label: "Устройство" },
  { label: "Покупка" },
  { label: "Тех. инфо" },
];

const LAST_STEP = STEPS.length - 1;
const PURCHASE_STEP = 2;

// Поля устройства, отправляемые на сервер (тип/вендор — только навигация).
const SUBMIT_FIELDS = [
  "companyId",
  "locationId",
  "deviceModelId",
  "serialNumber",
  "status",
  "purchasedAt",
  "price",
  "purchaseDocument",
  "supplierId",
  "warrantyExpirationDate",
  "ipAddress",
  "macAddress",
  "operatingSystem",
  "lastMaintenanceDate",
  "notes",
];

const STEP_ERRORS = {
  0: "Выберите компанию",
  1: "Заполните тип, вендора, модель и серийный номер",
};

// ISO date -> "yyyy-MM-dd" для <input type="date">.
const toDateInput = (date) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

// Ссылка может прийти populated ({_id}) или сырым id.
const refId = (value) => value?._id || value || "";

const findOption = (options, value) =>
  options.find((option) => option.value === value) || null;

const stepVariants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};

// Select с кнопкой быстрого создания справочника рядом.
const SelectWithAdd = ({ addTitle, onAdd, addDisabled, ...selectProps }) => (
  <div className="d-flex gap-2">
    <div className="flex-grow-1">
      <Select {...selectProps} />
    </div>
    <Button
      variant="outline-secondary"
      title={addTitle}
      onClick={onAdd}
      disabled={addDisabled}
    >
      <RiAddLine />
    </Button>
  </div>
);

const ClientDeviceForm = ({ title }) => {
  const data = useLoaderData();
  const isEdit = !!data?._id;

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [form, setForm] = useState({
    companyId: refId(data?.companyId),
    locationId: refId(data?.locationId),
    deviceTypeId: refId(data?.deviceModelId?.deviceTypeId),
    vendorId: refId(data?.deviceModelId?.vendorId),
    deviceModelId: refId(data?.deviceModelId),
    serialNumber: data?.serialNumber || "",
    status: data?.status || "readyForDeployment",
    purchasedAt: toDateInput(data?.purchasedAt),
    price: data?.price ?? "",
    purchaseDocument: data?.purchaseDocument || "",
    supplierId: refId(data?.supplierId),
    warrantyExpirationDate: toDateInput(data?.warrantyExpirationDate),
    lastMaintenanceDate: toDateInput(data?.lastMaintenanceDate),
    ipAddress: data?.ipAddress || "",
    macAddress: data?.macAddress || "",
    operatingSystem: data?.operatingSystem || "",
    notes: data?.notes || "",
  });

  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [deviceModels, setDeviceModels] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? LAST_STEP : 0);
  const [attempted, setAttempted] = useState(false);
  const [inlineKind, setInlineKind] = useState(null);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  // Загрузка справочников.
  useEffect(() => {
    const fetchReferenceData = async () => {
      setLoading(true);
      const { token } = getLocalStorageData();
      const headers = { Authorization: "Bearer " + token };
      const base = import.meta.env.VITE_API_ADDRESS;

      try {
        const responses = await Promise.all([
          fetch(`${base}/api/companies`, { headers }),
          fetch(`${base}/api/inventory/companies-locations`, { headers }),
          fetch(`${base}/api/inventory/device-types`, { headers }),
          fetch(`${base}/api/inventory/vendors`, { headers }),
          fetch(`${base}/api/inventory/device-models`, { headers }),
          fetch(`${base}/api/inventory/suppliers`, { headers }),
        ]);

        const [
          companiesData,
          locationsData,
          typesData,
          vendorsData,
          modelsData,
          suppliersData,
        ] = await Promise.all(responses.map((r) => r.json()));

        setCompanies(Array.isArray(companiesData) ? companiesData : []);
        setLocations(Array.isArray(locationsData) ? locationsData : []);
        setDeviceTypes(Array.isArray(typesData) ? typesData : []);
        setVendors(Array.isArray(vendorsData) ? vendorsData : []);
        setDeviceModels(Array.isArray(modelsData) ? modelsData : []);
        setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
      } catch (error) {
        console.error("Error fetching reference data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchReferenceData();
  }, []);

  // Успешный сабмит — закрываем offcanvas и возвращаемся к списку.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      navigate("..");
    }
  }, [fetcher.state, fetcher.data]);

  // --- options ---
  const companyOptions = useMemo(
    () =>
      companies.map((company) => ({
        value: company._id,
        label: company.alias || company.fullTitle,
      })),
    [companies],
  );

  const locationOptions = useMemo(
    () =>
      locations.map((location) => ({
        value: location._id,
        label: location.company?.alias
          ? `${location.name} — ${location.company.alias}`
          : location.name,
      })),
    [locations],
  );

  const typeOptions = useMemo(
    () => deviceTypes.map((type) => ({ value: type._id, label: type.name })),
    [deviceTypes],
  );

  // Вендоры показываем все (без фильтра по типу — иначе для нового типа список
  // всегда пуст). Сужение происходит уже на уровне моделей.
  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ value: v._id, label: v.name })),
    [vendors],
  );

  // Модели выбранного типа и вендора.
  const modelOptions = useMemo(() => {
    if (!form.deviceTypeId || !form.vendorId) return [];
    return deviceModels
      .filter(
        (model) =>
          model.deviceTypeId?._id === form.deviceTypeId &&
          model.vendorId?._id === form.vendorId,
      )
      .map((model) => ({
        value: model._id,
        label: model.name || "— без названия —",
      }));
  }, [deviceModels, form.deviceTypeId, form.vendorId]);

  const modelDisabled = !form.deviceTypeId || !form.vendorId;

  // --- каскадные сбросы: модель зависит от типа и вендора ---
  const handleTypeChange = (value) =>
    setForm((prev) => ({ ...prev, deviceTypeId: value, deviceModelId: "" }));

  const handleVendorChange = (value) =>
    setForm((prev) => ({ ...prev, vendorId: value, deviceModelId: "" }));

  // --- инлайн-создание справочников ---
  const handleTypeCreated = (type) => {
    setDeviceTypes((prev) => [...prev, type]);
    setForm((prev) => ({ ...prev, deviceTypeId: type._id, deviceModelId: "" }));
  };

  const handleVendorCreated = (vendor) => {
    setVendors((prev) => [...prev, vendor]);
    setForm((prev) => ({ ...prev, vendorId: vendor._id, deviceModelId: "" }));
  };

  const handleModelCreated = (model) => {
    setDeviceModels((prev) => [...prev, model]);
    setField("deviceModelId", model._id);
  };

  const handleSupplierCreated = (supplier) =>
    setSuppliers((prev) => [...prev, supplier]);

  // --- валидация шагов ---
  const stepValid = (index) => {
    switch (index) {
      case 0:
        return !!form.companyId;
      case 1:
        return (
          !!form.deviceTypeId &&
          !!form.vendorId &&
          !!form.deviceModelId &&
          form.serialNumber.trim().length > 0
        );
      default:
        return true;
    }
  };

  // --- навигация ---
  const goToStep = (index) => {
    setAttempted(false);
    setStep(index);
  };

  const handleNext = () => {
    if (!stepValid(step)) {
      setAttempted(true);
      return;
    }
    const next = Math.min(step + 1, LAST_STEP);
    setAttempted(false);
    setStep(next);
    setMaxReached((prev) => Math.max(prev, next));
  };

  const handleBack = () => {
    setAttempted(false);
    setStep((s) => Math.max(0, s - 1));
  };

  const handleStepClick = (index) => {
    if (isEdit || index <= maxReached) goToStep(index);
  };

  const handleClose = () => {
    offcanvas.setClose();
    navigate(-1);
  };

  const saving = fetcher.state !== "idle";

  const handleSubmit = () => {
    const formData = new FormData();
    SUBMIT_FIELDS.forEach((field) => formData.append(field, form[field] ?? ""));
    fetcher.submit(formData, { method: "post" });
  };

  // Контекст для инлайн-создания модели (тип/вендор уже выбраны).
  const modelContext = {
    deviceTypeId: form.deviceTypeId,
    vendorId: form.vendorId,
    deviceTypeName: deviceTypes.find((t) => t._id === form.deviceTypeId)?.name,
    vendorName: vendors.find((v) => v._id === form.vendorId)?.name,
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Компания и расположение</h6>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="companyId">
                  Компания <span className="text-danger">*</span>
                </Form.Label>
                <Select
                  id="companyId"
                  placeholder="Выберите компанию"
                  options={companyOptions}
                  value={findOption(companyOptions, form.companyId)}
                  onChange={(o) => setField("companyId", o ? o.value : "")}
                  isClearable
                  autoFocus
                />
              </Form.Group>
              <Form.Group className="mb-0">
                <Form.Label htmlFor="locationId">Расположение</Form.Label>
                <Select
                  id="locationId"
                  placeholder="Выберите расположение"
                  options={locationOptions}
                  value={findOption(locationOptions, form.locationId)}
                  onChange={(o) => setField("locationId", o ? o.value : "")}
                  isClearable
                />
              </Form.Group>
            </Card.Body>
          </Card>
        );

      case 1:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Тип, вендор и модель</h6>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="deviceTypeId">
                      Тип устройства <span className="text-danger">*</span>
                    </Form.Label>
                    <SelectWithAdd
                      id="deviceTypeId"
                      placeholder="Выберите тип"
                      options={typeOptions}
                      value={findOption(typeOptions, form.deviceTypeId)}
                      onChange={(o) => handleTypeChange(o ? o.value : "")}
                      isClearable
                      autoFocus
                      addTitle="Добавить тип"
                      onAdd={() => setInlineKind("deviceType")}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="vendorId">
                      Вендор <span className="text-danger">*</span>
                    </Form.Label>
                    <SelectWithAdd
                      id="vendorId"
                      placeholder="Выберите вендора"
                      options={vendorOptions}
                      value={findOption(vendorOptions, form.vendorId)}
                      onChange={(o) => handleVendorChange(o ? o.value : "")}
                      isClearable
                      addTitle="Добавить вендора"
                      onAdd={() => setInlineKind("vendor")}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label htmlFor="deviceModelId">
                  Модель устройства <span className="text-danger">*</span>
                </Form.Label>
                <SelectWithAdd
                  id="deviceModelId"
                  placeholder={
                    modelDisabled
                      ? "Сначала выберите тип и вендора"
                      : "Выберите модель"
                  }
                  options={modelOptions}
                  value={findOption(modelOptions, form.deviceModelId)}
                  onChange={(o) => setField("deviceModelId", o ? o.value : "")}
                  isDisabled={modelDisabled}
                  isClearable
                  noOptionsMessage={() => "Нет моделей — добавьте кнопкой рядом"}
                  addTitle="Добавить модель"
                  onAdd={() => setInlineKind("deviceModel")}
                  addDisabled={modelDisabled}
                />
                <Form.Text className="text-muted">
                  Показаны модели выбранного типа и вендора. Нужной нет?
                  Добавьте её кнопкой рядом.
                </Form.Text>
              </Form.Group>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3 mb-md-0">
                    <Form.Label htmlFor="serialNumber">
                      Серийный номер <span className="text-danger">*</span>
                    </Form.Label>
                    <Form.Control
                      id="serialNumber"
                      name="serialNumber"
                      type="text"
                      placeholder="Введите серийный номер"
                      value={form.serialNumber}
                      onChange={(e) => setField("serialNumber", e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-0">
                    <Form.Label htmlFor="status">Статус</Form.Label>
                    <Select
                      id="status"
                      placeholder="Выберите статус"
                      options={STATUS_OPTIONS}
                      value={findOption(STATUS_OPTIONS, form.status)}
                      onChange={(o) =>
                        setField("status", o ? o.value : "readyForDeployment")
                      }
                      isClearable={false}
                    />
                  </Form.Group>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        );

      case 2:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Покупка</h6>
              <small className="text-muted">Необязательный блок</small>
            </Card.Header>
            <Card.Body>
              <PurchaseFields
                values={form}
                onChange={setField}
                suppliers={suppliers}
                onSupplierCreated={handleSupplierCreated}
              />
            </Card.Body>
          </Card>
        );

      case 3:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Техническая информация</h6>
              <small className="text-muted">Необязательный блок</small>
            </Card.Header>
            <Card.Body>
              <TechFields values={form} onChange={setField} />
            </Card.Body>
          </Card>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Container className="text-center py-5">
        <Spinner animation="border" />
      </Container>
    );
  }

  return (
    <Container>
      <h1>{title}</h1>
      <hr />

      <WizardStepper
        steps={STEPS}
        currentStep={step}
        maxReached={maxReached}
        allowJump={isEdit}
        onStepClick={handleStepClick}
      />

      {fetcher.data && fetcher.data.error && (
        <AlertMessage variant="danger" message={fetcher.data.message} />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={stepVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25 }}
        >
          {renderStep()}
        </motion.div>
      </AnimatePresence>

      {attempted && !stepValid(step) && STEP_ERRORS[step] && (
        <p className="text-danger small mt-2 mb-0">{STEP_ERRORS[step]}</p>
      )}

      <hr />
      <Stack direction="horizontal" gap={2}>
        <Button variant="secondary" onClick={handleClose} disabled={saving}>
          <RiArrowGoBackFill /> Закрыть
        </Button>

        <div className="ms-auto d-flex gap-2">
          {step > 0 && (
            <Button
              variant="outline-secondary"
              onClick={handleBack}
              disabled={saving}
            >
              <RiArrowLeftLine /> Назад
            </Button>
          )}

          {step === PURCHASE_STEP && (
            <Button variant="outline-primary" onClick={handleNext}>
              Пропустить
            </Button>
          )}

          {step < LAST_STEP && (
            <Button variant="primary" onClick={handleNext}>
              Далее <RiArrowRightLine />
            </Button>
          )}

          {step === LAST_STEP && (
            <Button variant="primary" onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <Spinner animation="border" size="sm" />
              ) : (
                <>
                  <RiSaveLine /> Сохранить
                </>
              )}
            </Button>
          )}
        </div>
      </Stack>

      <InlineCreateModal
        show={inlineKind === "deviceType"}
        onHide={() => setInlineKind(null)}
        kind="deviceType"
        onCreated={handleTypeCreated}
      />
      <InlineCreateModal
        show={inlineKind === "vendor"}
        onHide={() => setInlineKind(null)}
        kind="vendor"
        onCreated={handleVendorCreated}
      />
      <InlineCreateModal
        show={inlineKind === "deviceModel"}
        onHide={() => setInlineKind(null)}
        kind="deviceModel"
        context={modelContext}
        onCreated={handleModelCreated}
      />
    </Container>
  );
};

export default ClientDeviceForm;
