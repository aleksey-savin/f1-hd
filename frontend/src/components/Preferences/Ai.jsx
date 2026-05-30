import { useState, useEffect, useCallback } from "react";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";

import { RiRefreshLine } from "react-icons/ri";

import { getLocalStorageData } from "../../util/auth";

const PrefsAi = (props) => {
  if (!props.prefs.ai) {
    props.prefs.ai = {
      isActive: false,
      provider: "openai",
      openai: { apiKey: "", model: "" },
      anthropic: { apiKey: "", model: "" },
    };
  }

  const { ai } = props.prefs;
  const { token } = getLocalStorageData();

  const [isActive, setIsActive] = useState(ai.isActive);
  const [provider, setProvider] = useState(ai.provider);

  const [openaiApiKey, setOpenaiApiKey] = useState(ai.openai?.apiKey);
  const [openaiModel, setOpenaiModel] = useState(ai.openai?.model);

  const [anthropicApiKey, setAnthropicApiKey] = useState(ai.anthropic?.apiKey);
  const [anthropicModel, setAnthropicModel] = useState(ai.anthropic?.model);

  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  const currentApiKey = provider === "openai" ? openaiApiKey : anthropicApiKey;

  const loadModels = useCallback(async () => {
    const apiKey = provider === "openai" ? openaiApiKey : anthropicApiKey;

    if (!apiKey) {
      setModels([]);
      setModelsError("Сначала укажите API-ключ");
      return;
    }

    setLoadingModels(true);
    setModelsError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/preferences/ai-models`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ provider, apiKey }),
        },
      );

      if (!response.ok) {
        throw new Error();
      }

      const data = await response.json();
      setModels(data.models || []);
    } catch {
      setModels([]);
      setModelsError("Не удалось загрузить список моделей");
    } finally {
      setLoadingModels(false);
    }
  }, [provider, openaiApiKey, anthropicApiKey, token]);

  // Reload the catalog whenever the provider changes (if a key is present).
  useEffect(() => {
    setModels([]);
    setModelsError(null);
    if (isActive && currentApiKey) {
      loadModels();
    }
  }, [provider]);

  // Keep the saved model selectable even if it isn't in the fetched list.
  const modelOptions = (current) => {
    const list = [...models];
    if (current && !list.some((model) => model.id === current)) {
      list.unshift({ id: current, name: current });
    }
    return list;
  };

  const isActiveHandler = () => {
    setIsActive(!isActive);
    ai.isActive = !isActive;
  };

  const providerHandler = (event) => {
    setProvider(event.target.value);
    ai.provider = event.target.value;
  };

  const openaiApiKeyHandler = (event) => {
    setOpenaiApiKey(event.target.value);
    ai.openai.apiKey = event.target.value;
  };

  const openaiModelHandler = (event) => {
    setOpenaiModel(event.target.value);
    ai.openai.model = event.target.value;
  };

  const anthropicApiKeyHandler = (event) => {
    setAnthropicApiKey(event.target.value);
    ai.anthropic.apiKey = event.target.value;
  };

  const anthropicModelHandler = (event) => {
    setAnthropicModel(event.target.value);
    ai.anthropic.model = event.target.value;
  };

  const renderModelField = (currentModel, onChange) => (
    <Form.Group className="mb-3 w-100">
      <Form.Label>Модель</Form.Label>
      <Row className="g-2 align-items-center">
        <Col>
          <Form.Select
            disabled={!isActive || loadingModels || !currentApiKey}
            value={currentModel}
            onChange={onChange}
          >
            {modelOptions(currentModel).length === 0 && (
              <option value="">— загрузите список моделей —</option>
            )}
            {modelOptions(currentModel).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </Form.Select>
        </Col>
        <Col xs="auto">
          <Button
            variant="outline-secondary"
            disabled={!isActive || loadingModels || !currentApiKey}
            onClick={loadModels}
            title="Обновить список моделей"
          >
            {loadingModels ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RiRefreshLine />
            )}
          </Button>
        </Col>
      </Row>
      {modelsError && (
        <Form.Text className="text-danger">{modelsError}</Form.Text>
      )}
    </Form.Group>
  );

  return (
    <>
      <Row>
        <Col xs="auto">
          <h1 className="display-6 mb-3">Искусственный интеллект</h1>
          <Form.Group className="mb-3 w-100">
            <Form.Check
              type="switch"
              label="Использовать AI"
              checked={isActive}
              value={isActive}
              onChange={isActiveHandler}
            />
          </Form.Group>
          <Form.Group className="mb-3 w-100">
            <Form.Label>Провайдер</Form.Label>
            <Form.Select
              disabled={!isActive}
              value={provider}
              onChange={providerHandler}
            >
              <option value="openai">OpenAI ChatGPT</option>
              <option value="anthropic">Anthropic Claude</option>
            </Form.Select>
          </Form.Group>

          {provider === "openai" && (
            <>
              <Form.Group className="mb-3 w-100">
                <Form.Label>API-ключ OpenAI</Form.Label>
                <Form.Control
                  disabled={!isActive}
                  type="password"
                  value={openaiApiKey}
                  onChange={openaiApiKeyHandler}
                />
              </Form.Group>
              {renderModelField(openaiModel, openaiModelHandler)}
            </>
          )}

          {provider === "anthropic" && (
            <>
              <Form.Group className="mb-3 w-100">
                <Form.Label>API-ключ Anthropic</Form.Label>
                <Form.Control
                  disabled={!isActive}
                  type="password"
                  value={anthropicApiKey}
                  onChange={anthropicApiKeyHandler}
                />
              </Form.Group>
              {renderModelField(anthropicModel, anthropicModelHandler)}
            </>
          )}

          <Form.Group>
            <Alert variant="light">
              Список моделей загружается напрямую от выбранного провайдера по
              вашему API-ключу. Нажмите кнопку обновления после ввода ключа.
            </Alert>
          </Form.Group>
        </Col>
      </Row>
    </>
  );
};

export default PrefsAi;
