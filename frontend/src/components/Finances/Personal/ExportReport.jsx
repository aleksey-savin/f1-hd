import { useState } from "react";
import {
  Button,
  Dropdown,
  Modal,
  Form,
  Row,
  Col,
  Alert,
} from "react-bootstrap";
import {
  RiDownloadLine,
  RiFileExcelLine,
  RiFilePdfLine,
  RiFileTextLine,
} from "react-icons/ri";
import { formatPrice } from "../../../util/format-string";

const ExportReport = ({ data, dateRange, onExport }) => {
  const [showModal, setShowModal] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("excel");
  const [exportOptions, setExportOptions] = useState({
    includeStatistics: true,
    includeCompletedWorks: true,
    includePreviewWorks: true,
    includeCalendar: false,
    groupByCompany: false,
    groupByStatus: false,
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!data || !onExport) return;

    setIsExporting(true);
    try {
      await onExport({
        format: selectedFormat,
        options: exportOptions,
        data: data,
        dateRange: dateRange,
      });
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
      setShowModal(false);
    }
  };

  const handleOptionChange = (option, value) => {
    setExportOptions((prev) => ({
      ...prev,
      [option]: value,
    }));
  };

  const exportFormats = [
    {
      key: "excel",
      label: "Excel (.xlsx)",
      icon: RiFileExcelLine,
      description:
        "Экспорт в формате Excel с возможностью дальнейшей обработки",
    },
    {
      key: "pdf",
      label: "PDF (.pdf)",
      icon: RiFilePdfLine,
      description: "Экспорт в PDF для печати и архивирования",
    },
    {
      key: "csv",
      label: "CSV (.csv)",
      icon: RiFileTextLine,
      description: "Экспорт в CSV для импорта в другие системы",
    },
  ];

  const getDataSummary = () => {
    if (!data) return null;

    const completedWorksCount = data.completedWorks?.length || 0;
    const previewWorksCount = data.previewWorks?.length || 0;
    const totalEarnings = data.totalEarnings || 0;

    return {
      completedWorksCount,
      previewWorksCount,
      totalEarnings,
      totalWorks: completedWorksCount + previewWorksCount,
    };
  };

  const summary = getDataSummary();

  return (
    <>
      <Dropdown>
        <Dropdown.Toggle
          variant="success"
          id="export-dropdown"
          disabled={
            !data ||
            (!data.completedWorks?.length && !data.previewWorks?.length)
          }
        >
          <RiDownloadLine className="me-2" />
          Экспорт
        </Dropdown.Toggle>

        <Dropdown.Menu>
          {exportFormats.map((format) => (
            <Dropdown.Item
              key={format.key}
              onClick={() => {
                setSelectedFormat(format.key);
                setShowModal(true);
              }}
            >
              <format.icon className="me-2" />
              {format.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown>

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Экспорт персонального отчёта</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {summary && (
            <Alert variant="info" className="mb-4">
              <h6>Сводка отчёта:</h6>
              <Row>
                <Col md={6}>
                  <ul className="mb-0">
                    <li>
                      Выполненных работ:{" "}
                      <strong>{summary.completedWorksCount}</strong>
                    </li>
                    <li>
                      Работ на утверждение:{" "}
                      <strong>{summary.previewWorksCount}</strong>
                    </li>
                  </ul>
                </Col>
                <Col md={6}>
                  <ul className="mb-0">
                    <li>
                      Общий заработок:{" "}
                      <strong>{formatPrice(summary.totalEarnings)}</strong>
                    </li>
                    <li>
                      Период:{" "}
                      <strong>
                        {dateRange?.from} - {dateRange?.to}
                      </strong>
                    </li>
                  </ul>
                </Col>
              </Row>
            </Alert>
          )}

          <Form>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Формат экспорта</Form.Label>
                  {exportFormats.map((format) => (
                    <Form.Check
                      key={format.key}
                      type="radio"
                      id={`format-${format.key}`}
                      name="exportFormat"
                      label={
                        <div>
                          <format.icon className="me-2" />
                          <strong>{format.label}</strong>
                          <br />
                          <small className="text-muted">
                            {format.description}
                          </small>
                        </div>
                      }
                      checked={selectedFormat === format.key}
                      onChange={() => setSelectedFormat(format.key)}
                      className="mb-2"
                    />
                  ))}
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Включить в экспорт</Form.Label>

                  <Form.Check
                    type="checkbox"
                    id="include-statistics"
                    label="Статистика и сводные данные"
                    checked={exportOptions.includeStatistics}
                    onChange={(e) =>
                      handleOptionChange("includeStatistics", e.target.checked)
                    }
                    className="mb-2"
                  />

                  <Form.Check
                    type="checkbox"
                    id="include-completed"
                    label="Выполненные работы"
                    checked={exportOptions.includeCompletedWorks}
                    onChange={(e) =>
                      handleOptionChange(
                        "includeCompletedWorks",
                        e.target.checked,
                      )
                    }
                    className="mb-2"
                  />

                  <Form.Check
                    type="checkbox"
                    id="include-preview"
                    label="Работы на утверждение"
                    checked={exportOptions.includePreviewWorks}
                    onChange={(e) =>
                      handleOptionChange(
                        "includePreviewWorks",
                        e.target.checked,
                      )
                    }
                    className="mb-2"
                  />

                  {selectedFormat === "excel" && (
                    <Form.Check
                      type="checkbox"
                      id="include-calendar"
                      label="Календарь активности"
                      checked={exportOptions.includeCalendar}
                      onChange={(e) =>
                        handleOptionChange("includeCalendar", e.target.checked)
                      }
                      className="mb-2"
                    />
                  )}
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Группировка данных</Form.Label>

                  <Form.Check
                    type="checkbox"
                    id="group-company"
                    label="Группировать по компаниям"
                    checked={exportOptions.groupByCompany}
                    onChange={(e) =>
                      handleOptionChange("groupByCompany", e.target.checked)
                    }
                    className="mb-2"
                  />

                  <Form.Check
                    type="checkbox"
                    id="group-status"
                    label="Группировать по статусам"
                    checked={exportOptions.groupByStatus}
                    onChange={(e) =>
                      handleOptionChange("groupByStatus", e.target.checked)
                    }
                    className="mb-2"
                  />
                </Form.Group>
              </Col>
            </Row>

            {selectedFormat === "pdf" && (
              <Alert variant="warning">
                <small>
                  <strong>Примечание:</strong> PDF экспорт оптимизирован для
                  печати. Календарь активности не будет включен в PDF формат.
                </small>
              </Alert>
            )}

            {selectedFormat === "csv" && (
              <Alert variant="info">
                <small>
                  <strong>Примечание:</strong> CSV формат содержит только
                  табличные данные работ. Статистика и календарь будут
                  исключены.
                </small>
              </Alert>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            Отмена
          </Button>
          <Button
            variant="success"
            onClick={handleExport}
            disabled={
              isExporting ||
              (!exportOptions.includeCompletedWorks &&
                !exportOptions.includePreviewWorks)
            }
          >
            {isExporting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Экспорт...
              </>
            ) : (
              <>
                <RiDownloadLine className="me-2" />
                Экспортировать
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default ExportReport;
