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
      speechToText: {
        isActive: false,
        provider: "openai",
        apiKey: "",
        model: "gpt-4o-transcribe-diarize",
        yandex: { apiKey: "", folderId: "", model: "general" },
      },
    };
  }

  const { ai } = props.prefs;
  ai.isActive = ai.isActive || false;
  ai.provider = ai.provider || "openai";
  ai.openai = { apiKey: "", model: "", ...(ai.openai || {}) };
  ai.anthropic = { apiKey: "", model: "", ...(ai.anthropic || {}) };
  ai.speechToText = {
    isActive: false,
    provider: "openai",
    apiKey: "",
    model: "gpt-4o-transcribe-diarize",
    ...(ai.speechToText || {}),
  };
  ai.speechToText.yandex = {
    apiKey: "",
    folderId: "",
    model: "general",
    ...(ai.speechToText.yandex || {}),
  };
  const { token } = getLocalStorageData();

  const [isActive, setIsActive] = useState(ai.isActive);
  const [provider, setProvider] = useState(ai.provider);

  const [openaiApiKey, setOpenaiApiKey] = useState(ai.openai?.apiKey);
  const [openaiModel, setOpenaiModel] = useState(ai.openai?.model);

  const [anthropicApiKey, setAnthropicApiKey] = useState(ai.anthropic?.apiKey);
  const [anthropicModel, setAnthropicModel] = useState(ai.anthropic?.model);

  const [speechIsActive, setSpeechIsActive] = useState(
    ai.speechToText?.isActive,
  );
  const [speechProvider, setSpeechProvider] = useState(
    ai.speechToText?.provider || "openai",
  );
  const [speechApiKey, setSpeechApiKey] = useState(ai.speechToText?.apiKey);
  const [speechModel, setSpeechModel] = useState(ai.speechToText?.model);
  const [yandexSpeechApiKey, setYandexSpeechApiKey] = useState(
    ai.speechToText?.yandex?.apiKey,
  );
  const [yandexSpeechFolderId, setYandexSpeechFolderId] = useState(
    ai.speechToText?.yandex?.folderId,
  );
  const yandexSpeechModel = ai.speechToText?.yandex?.model || "general";

  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [speechModels, setSpeechModels] = useState([]);
  const [loadingSpeechModels, setLoadingSpeechModels] = useState(false);
  const [speechModelsError, setSpeechModelsError] = useState(null);

  const currentApiKey = provider === "openai" ? openaiApiKey : anthropicApiKey;
  const speechDiarizeModel = "gpt-4o-transcribe-diarize";

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

  const loadSpeechModels = useCallback(async () => {
    if (!speechApiKey) {
      setSpeechModels([]);
      setSpeechModelsError("Сначала укажите API-ключ");
      return;
    }

    setLoadingSpeechModels(true);
    setSpeechModelsError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/preferences/ai-models`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            provider: "openai",
            apiKey: speechApiKey,
            feature: "speechToText",
          }),
        },
      );

      if (!response.ok) {
        throw new Error();
      }

      const data = await response.json();
      setSpeechModels(data.models || []);
    } catch {
      setSpeechModels([]);
      setSpeechModelsError("Не удалось загрузить список моделей");
    } finally {
      setLoadingSpeechModels(false);
    }
  }, [speechApiKey, token]);

  // Reload the catalog whenever the provider changes (if a key is present).
  useEffect(() => {
    setModels([]);
    setModelsError(null);
    if (isActive && currentApiKey) {
      loadModels();
    }
  }, [provider]);

  useEffect(() => {
    setSpeechModels([]);
    setSpeechModelsError(null);
    if (speechIsActive && speechApiKey) {
      loadSpeechModels();
    }
  }, [speechIsActive]);

  // Keep the saved model selectable even if it isn't in the fetched list.
  const modelOptions = (current, availableModels) => {
    const list = [...availableModels];
    if (current && !list.some((model) => model.id === current)) {
      list.unshift({ id: current, name: current });
    }
    return list;
  };

  const speechModelOptions = () => {
    const list = modelOptions(speechModel, speechModels);

    return list.sort((first, second) => {
      if (first.id === speechDiarizeModel) return -1;
      if (second.id === speechDiarizeModel) return 1;
      return first.id.localeCompare(second.id);
    });
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

  const speechIsActiveHandler = () => {
    setSpeechIsActive(!speechIsActive);
    ai.speechToText.isActive = !speechIsActive;
  };

  const speechProviderHandler = (event) => {
    setSpeechProvider(event.target.value);
    ai.speechToText.provider = event.target.value;
  };

  const speechApiKeyHandler = (event) => {
    setSpeechApiKey(event.target.value);
    ai.speechToText.apiKey = event.target.value;
  };

  const yandexSpeechApiKeyHandler = (event) => {
    setYandexSpeechApiKey(event.target.value);
    ai.speechToText.yandex.apiKey = event.target.value;
  };

  const yandexSpeechFolderIdHandler = (event) => {
    setYandexSpeechFolderId(event.target.value);
    ai.speechToText.yandex.folderId = event.target.value;
  };

  const speechModelHandler = (event) => {
    setSpeechModel(event.target.value);
    ai.speechToText.model = event.target.value;
  };

  const renderModelField = ({
    currentModel,
    onChange,
    availableModels,
    loading,
    error,
    disabled,
    onRefresh,
  }) => (
    <Form.Group className="mb-3 w-100">
      <Form.Label>Модель</Form.Label>
      <Row className="g-2 align-items-center">
        <Col>
          <Form.Select
            disabled={disabled || loading}
            value={currentModel}
            onChange={onChange}
          >
            {modelOptions(currentModel, availableModels).length === 0 && (
              <option value="">— загрузите список моделей —</option>
            )}
            {modelOptions(currentModel, availableModels).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </Form.Select>
        </Col>
        <Col xs="auto">
          <Button
            variant="outline-secondary"
            disabled={disabled || loading}
            onClick={onRefresh}
            title="Обновить список моделей"
          >
            {loading ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RiRefreshLine />
            )}
          </Button>
        </Col>
      </Row>
      {error && <Form.Text className="text-danger">{error}</Form.Text>}
    </Form.Group>
  );

  const renderSpeechModelField = () => (
    <Form.Group className="mb-3 w-100">
      <Form.Label>Модель</Form.Label>
      <Row className="g-2 align-items-center">
        <Col>
          <Form.Select
            disabled={!speechIsActive || loadingSpeechModels || !speechApiKey}
            value={speechModel}
            onChange={speechModelHandler}
          >
            {speechModelOptions().length === 0 && (
              <option value="">— загрузите список моделей —</option>
            )}
            {speechModelOptions().map((model) => (
              <option key={model.id} value={model.id}>
                {model.id === speechDiarizeModel
                  ? `${model.name} (roles)`
                  : model.name}
              </option>
            ))}
          </Form.Select>
        </Col>
        <Col xs="auto">
          <Button
            variant="outline-secondary"
            disabled={!speechIsActive || loadingSpeechModels || !speechApiKey}
            onClick={loadSpeechModels}
            title="Обновить список моделей"
          >
            {loadingSpeechModels ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RiRefreshLine />
            )}
          </Button>
        </Col>
      </Row>
      {speechModelsError && (
        <Form.Text className="text-danger">{speechModelsError}</Form.Text>
      )}
      {speechModel !== speechDiarizeModel && (
        <Form.Text className="text-warning">
          Разделение по участникам работает только с{" "}
          {speechDiarizeModel}.
        </Form.Text>
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
              {renderModelField({
                currentModel: openaiModel,
                onChange: openaiModelHandler,
                availableModels: models,
                loading: loadingModels,
                error: modelsError,
                disabled: !isActive || !currentApiKey,
                onRefresh: loadModels,
              })}
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
              {renderModelField({
                currentModel: anthropicModel,
                onChange: anthropicModelHandler,
                availableModels: models,
                loading: loadingModels,
                error: modelsError,
                disabled: !isActive || !currentApiKey,
                onRefresh: loadModels,
              })}
            </>
          )}

          <hr />

          <Form.Group className="mb-3 w-100">
            <Form.Check
              type="switch"
              label="Speech recognition"
              checked={speechIsActive}
              value={speechIsActive}
              onChange={speechIsActiveHandler}
            />
          </Form.Group>
          <Form.Group className="mb-3 w-100">
            <Form.Label>Провайдер распознавания речи</Form.Label>
            <Form.Select
              disabled={!speechIsActive}
              value={speechProvider}
              onChange={speechProviderHandler}
            >
              <option value="openai">OpenAI</option>
              <option value="yandex">Yandex SpeechKit</option>
            </Form.Select>
          </Form.Group>

          {speechProvider === "openai" && (
            <>
              <Form.Group className="mb-3 w-100">
                <Form.Label>
                  API-ключ OpenAI для распознавания речи
                </Form.Label>
                <Form.Control
                  disabled={!speechIsActive}
                  type="password"
                  value={speechApiKey}
                  onChange={speechApiKeyHandler}
                />
              </Form.Group>
              {renderSpeechModelField()}
            </>
          )}

          {speechProvider === "yandex" && (
            <>
              <Form.Group className="mb-3 w-100">
                <Form.Label>API-ключ Yandex SpeechKit</Form.Label>
                <Form.Control
                  disabled={!speechIsActive}
                  type="password"
                  value={yandexSpeechApiKey}
                  onChange={yandexSpeechApiKeyHandler}
                />
              </Form.Group>
              <Form.Group className="mb-3 w-100">
                <Form.Label>Идентификатор каталога (folder ID)</Form.Label>
                <Form.Control
                  disabled={!speechIsActive}
                  type="text"
                  value={yandexSpeechFolderId}
                  onChange={yandexSpeechFolderIdHandler}
                />
              </Form.Group>
              <Form.Group className="mb-3 w-100">
                <Form.Label>Модель</Form.Label>
                <Form.Select disabled value={yandexSpeechModel}>
                  <option value="general">general (Yandex SpeechKit)</option>
                </Form.Select>
                <Form.Text className="text-muted">
                  Yandex SpeechKit распознаёт русскую речь с разделением по
                  участникам (поддерживаются MP3, WAV и OGG/OPUS).
                </Form.Text>
              </Form.Group>
            </>
          )}

          <Form.Group>
            <Alert variant="light">
              Список моделей чата загружается напрямую от выбранного провайдера
              по вашему API-ключу — нажмите кнопку обновления после ввода ключа.
              Для распознавания речи доступны OpenAI (модели speech-to-text) и
              Yandex SpeechKit.
            </Alert>
          </Form.Group>
        </Col>
      </Row>
    </>
  );
};

export default PrefsAi;
