import { useEffect, useState } from "react";

import { RiRefreshLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";
import SectionForm from "./SectionForm";

// «Искусственный интеллект» — канон «селектор → условный блок»: мастер-свитч,
// провайдер, его поля. Список моделей подгружается по ключу (кнопка
// обновления); сохранённая модель остаётся выбираемой, даже если её нет в
// свежем списке. У YandexGPT каталог фиксированный (отдаёт бэкенд), у
// Yandex AI Studio модель вводится вручную. Секция владеет группой ai целиком.
const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "yandexgpt", label: "YandexGPT" },
  { value: "yandexai", label: "Yandex AI Studio" },
];
const SPEECH_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "yandex", label: "Yandex SpeechKit" },
];
// Провайдеры с динамическим каталогом моделей (по ключу); yandexgpt отдаёт
// фиксированный список тем же эндпоинтом
const LISTABLE = ["openai", "anthropic", "deepseek", "yandexgpt"];

const DEFAULT_AI = {
  isActive: false,
  provider: "openai",
  openai: { apiKey: "", model: "" },
  anthropic: { apiKey: "", model: "" },
  deepseek: { apiKey: "", model: "deepseek-chat" },
  yandexgpt: { apiKey: "", folderId: "", model: "yandexgpt" },
  yandexai: { apiKey: "", folderId: "", model: "deepseek-r1" },
  speechToText: {
    isActive: false,
    provider: "openai",
    apiKey: "",
    model: "gpt-4o-transcribe-diarize",
    yandex: { apiKey: "", folderId: "", model: "general" },
  },
};

// Сохранённая модель остаётся опцией, даже если каталог её не вернул
const withCurrent = (models, current) =>
  current && !models.some((model) => model.id === current)
    ? [{ id: current, name: current }, ...models]
    : models;

const PrefsAi = ({ prefs }) => {
  const [ai, setAi] = useState(() => {
    const stored = prefs.ai || {};
    return {
      ...DEFAULT_AI,
      ...stored,
      openai: { ...DEFAULT_AI.openai, ...(stored.openai || {}) },
      anthropic: { ...DEFAULT_AI.anthropic, ...(stored.anthropic || {}) },
      deepseek: { ...DEFAULT_AI.deepseek, ...(stored.deepseek || {}) },
      yandexgpt: { ...DEFAULT_AI.yandexgpt, ...(stored.yandexgpt || {}) },
      yandexai: { ...DEFAULT_AI.yandexai, ...(stored.yandexai || {}) },
      speechToText: {
        ...DEFAULT_AI.speechToText,
        ...(stored.speechToText || {}),
        yandex: {
          ...DEFAULT_AI.speechToText.yandex,
          ...(stored.speechToText?.yandex || {}),
        },
      },
    };
  });

  const patchTop = (patch) => setAi((current) => ({ ...current, ...patch }));
  const patchProvider = (key, patch) =>
    setAi((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  const patchSpeech = (patch) =>
    setAi((current) => ({
      ...current,
      speechToText: { ...current.speechToText, ...patch },
    }));
  const patchSpeechYandex = (patch) =>
    setAi((current) => ({
      ...current,
      speechToText: {
        ...current.speechToText,
        yandex: { ...current.speechToText.yandex, ...patch },
      },
    }));

  // Каталоги моделей (чат и распознавание) — по требованию, с ошибкой у поля
  const [models, setModels] = useState([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [speechModels, setSpeechModels] = useState([]);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechError, setSpeechError] = useState(null);

  const fetchModels = async ({ provider, apiKey, feature }) => {
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/preferences/ai-models`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ provider, apiKey, feature }),
      },
    );
    if (!response.ok) throw new Error();
    return (await response.json()).models || [];
  };

  const provider = ai.provider;
  const providerConf = ai[provider] || {};

  // Сохранённые ключи наружу не отдаются — форма получает только флаг «задан»
  // и рисует маску; пустое поле означает «не менять», а каталог моделей бэкенд
  // подтянет по сохранённому ключу.
  const providerKeyIsSet = !!prefs.ai?.[provider]?.apiKeyIsSet;
  const speechKeyIsSet = !!prefs.ai?.speechToText?.apiKeyIsSet;
  const speechYandexKeyIsSet = !!prefs.ai?.speechToText?.yandex?.apiKeyIsSet;

  const loadChatModels = async () => {
    if (!LISTABLE.includes(provider)) return;
    if (!providerConf.apiKey && !providerKeyIsSet && provider !== "yandexgpt") {
      setModels([]);
      setModelsError("Сначала укажите API-ключ");
      return;
    }
    setModelsBusy(true);
    setModelsError(null);
    try {
      setModels(await fetchModels({ provider, apiKey: providerConf.apiKey }));
    } catch {
      setModels([]);
      setModelsError("Не удалось загрузить список моделей");
    } finally {
      setModelsBusy(false);
    }
  };

  const speech = ai.speechToText;
  const loadSpeechModels = async () => {
    const yandex = speech.provider === "yandex";
    const apiKey = yandex ? speech.yandex.apiKey : speech.apiKey;
    if (!apiKey && !speechKeyIsSet && !yandex) {
      setSpeechModels([]);
      setSpeechError("Сначала укажите API-ключ");
      return;
    }
    setSpeechBusy(true);
    setSpeechError(null);
    try {
      setSpeechModels(
        await fetchModels({
          provider: yandex ? "yandex" : "openai",
          apiKey,
          feature: "speechToText",
        }),
      );
    } catch {
      setSpeechModels([]);
      setSpeechError("Не удалось загрузить список моделей");
    } finally {
      setSpeechBusy(false);
    }
  };

  // Смена провайдера сбрасывает каталог — он от другого сервиса
  useEffect(() => {
    setModels([]);
    setModelsError(null);
  }, [provider]);
  useEffect(() => {
    setSpeechModels([]);
    setSpeechError(null);
  }, [speech.provider]);

  const aiOn = !!ai.isActive;
  const speechOn = aiOn && !!speech.isActive;
  const dim = aiOn ? "tw:py-3" : "tw:py-3 tw:opacity-60";
  const dimSpeech = speechOn ? "tw:py-3" : "tw:py-3 tw:opacity-60";

  const chatModelValue = providerConf.model
    ? { id: providerConf.model, name: providerConf.model }
    : null;
  const chatModelOptions = withCurrent(models, providerConf.model);

  const speechModelValue = speech.model
    ? { id: speech.model, name: speech.model }
    : null;
  const speechModelOptions = withCurrent(speechModels, speech.model);

  return (
    <SectionForm buildPayload={() => ({ ai })}>
      <SettingRow
        title="Использовать AI"
        hint="Гайды по заявкам, определение категории, расшифровка звонков."
        htmlFor="prefs-ai-enabled"
      >
        <Switch
          id="prefs-ai-enabled"
          checked={aiOn}
          onCheckedChange={(value) => patchTop({ isActive: value })}
        />
      </SettingRow>
      <SettingRow divider title="Провайдер" htmlFor="prefs-ai-provider" className={dim}>
        <div className="tw:w-56 tw:max-md:w-full">
          <Select
            id="prefs-ai-provider"
            closeMenuOnSelect
            isDisabled={!aiOn}
            value={PROVIDERS.find((option) => option.value === provider)}
            options={PROVIDERS}
            getOptionLabel={(option) => option.label}
            getOptionValue={(option) => option.value}
            onChange={(option) =>
              patchTop({ provider: option?.value || "openai" })
            }
          />
        </div>
      </SettingRow>
      <SettingRow
        title={`API-ключ ${PROVIDERS.find((option) => option.value === provider)?.label}`}
        hint={
          providerKeyIsSet
            ? "Ключ задан и хранится в зашифрованном виде. Оставьте поле пустым, чтобы не менять."
            : undefined
        }
        htmlFor="prefs-ai-key"
        className={dim}
      >
        <Input
          id="prefs-ai-key"
          type="password"
          disabled={!aiOn}
          placeholder={providerKeyIsSet ? "••••••••  (задан)" : ""}
          value={providerConf.apiKey || ""}
          onChange={(event) =>
            patchProvider(provider, { apiKey: event.target.value })
          }
          className="tw:w-72 tw:max-md:w-full"
          autoComplete="new-password"
        />
      </SettingRow>
      {(provider === "yandexgpt" || provider === "yandexai") && (
        <SettingRow
          title="Идентификатор каталога (folder ID)"
          htmlFor="prefs-ai-folder"
          className={dim}
        >
          <Input
            id="prefs-ai-folder"
            type="text"
            disabled={!aiOn}
            value={providerConf.folderId || ""}
            onChange={(event) =>
              patchProvider(provider, { folderId: event.target.value })
            }
            className="tw:w-72 tw:max-md:w-full"
          />
        </SettingRow>
      )}
      <SettingRow
        title="Модель"
        hint={
          provider === "yandexai"
            ? "Идентификатор модели вводится вручную."
            : modelsError || "Список подгружается по ключу."
        }
        htmlFor="prefs-ai-model"
        className={dim}
      >
        <div className="tw:flex tw:items-center tw:gap-2">
          {provider === "yandexai" ? (
            <Input
              id="prefs-ai-model"
              type="text"
              disabled={!aiOn}
              value={providerConf.model || ""}
              onChange={(event) =>
                patchProvider(provider, { model: event.target.value })
              }
              className="tw:w-64 tw:max-md:w-full"
            />
          ) : (
            <>
              <div className="tw:w-64 tw:max-md:w-full">
                <Select
                  id="prefs-ai-model"
                  placeholder="— загрузите список —"
                  closeMenuOnSelect
                  isSearchable
                  isDisabled={!aiOn}
                  value={chatModelValue}
                  options={chatModelOptions}
                  getOptionLabel={(option) => option.name}
                  getOptionValue={(option) => option.id}
                  onChange={(option) =>
                    patchProvider(provider, { model: option?.id || "" })
                  }
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                disabled={!aiOn || modelsBusy}
                onClick={loadChatModels}
                title="Обновить список моделей"
                aria-label="Обновить список моделей"
              >
                <RiRefreshLine
                  className={modelsBusy ? "tw:animate-spin" : undefined}
                />
              </Button>
            </>
          )}
        </div>
      </SettingRow>

      <div className="tw:px-5 tw:pt-4">
        <SubLabel>Распознавание речи</SubLabel>
      </div>
      <SettingRow
        title="Расшифровывать аудио из заявок"
        hint="Голосовые сообщения и записи звонков — в текст."
        htmlFor="prefs-speech-enabled"
        className={aiOn ? "tw:py-3" : "tw:py-3 tw:opacity-60"}
      >
        <Switch
          id="prefs-speech-enabled"
          disabled={!aiOn}
          checked={!!speech.isActive}
          onCheckedChange={(value) => patchSpeech({ isActive: value })}
        />
      </SettingRow>
      <SettingRow
        title="Провайдер распознавания"
        htmlFor="prefs-speech-provider"
        className={dimSpeech}
      >
        <div className="tw:w-56 tw:max-md:w-full">
          <Select
            id="prefs-speech-provider"
            closeMenuOnSelect
            isDisabled={!speechOn}
            value={SPEECH_PROVIDERS.find(
              (option) => option.value === speech.provider,
            )}
            options={SPEECH_PROVIDERS}
            getOptionLabel={(option) => option.label}
            getOptionValue={(option) => option.value}
            onChange={(option) =>
              patchSpeech({ provider: option?.value || "openai" })
            }
          />
        </div>
      </SettingRow>
      {speech.provider === "yandex" ? (
        <>
          <SettingRow
            title="API-ключ Yandex SpeechKit"
            hint={
              speechYandexKeyIsSet
                ? "Ключ задан и хранится в зашифрованном виде. Оставьте поле пустым, чтобы не менять."
                : undefined
            }
            htmlFor="prefs-speech-yandex-key"
            className={dimSpeech}
          >
            <Input
              id="prefs-speech-yandex-key"
              type="password"
              disabled={!speechOn}
              placeholder={speechYandexKeyIsSet ? "••••••••  (задан)" : ""}
              value={speech.yandex.apiKey || ""}
              onChange={(event) =>
                patchSpeechYandex({ apiKey: event.target.value })
              }
              className="tw:w-72 tw:max-md:w-full"
              autoComplete="new-password"
            />
          </SettingRow>
          <SettingRow
            title="Идентификатор каталога (folder ID)"
            htmlFor="prefs-speech-yandex-folder"
            className={dimSpeech}
          >
            <Input
              id="prefs-speech-yandex-folder"
              type="text"
              disabled={!speechOn}
              value={speech.yandex.folderId || ""}
              onChange={(event) =>
                patchSpeechYandex({ folderId: event.target.value })
              }
              className="tw:w-72 tw:max-md:w-full"
            />
          </SettingRow>
        </>
      ) : (
        <>
          <SettingRow
            title="API-ключ OpenAI"
            hint={
              speechKeyIsSet
                ? "Ключ задан и хранится в зашифрованном виде. Оставьте поле пустым, чтобы не менять."
                : undefined
            }
            htmlFor="prefs-speech-key"
            className={dimSpeech}
          >
            <Input
              id="prefs-speech-key"
              type="password"
              disabled={!speechOn}
              placeholder={speechKeyIsSet ? "••••••••  (задан)" : ""}
              value={speech.apiKey || ""}
              onChange={(event) => patchSpeech({ apiKey: event.target.value })}
              className="tw:w-72 tw:max-md:w-full"
              autoComplete="new-password"
            />
          </SettingRow>
          <SettingRow
            title="Модель распознавания"
            hint={speechError || "Список подгружается по ключу."}
            htmlFor="prefs-speech-model"
            className={dimSpeech}
          >
            <div className="tw:flex tw:items-center tw:gap-2">
              <div className="tw:w-64 tw:max-md:w-full">
                <Select
                  id="prefs-speech-model"
                  placeholder="— загрузите список —"
                  closeMenuOnSelect
                  isSearchable
                  isDisabled={!speechOn}
                  value={speechModelValue}
                  options={speechModelOptions}
                  getOptionLabel={(option) => option.name}
                  getOptionValue={(option) => option.id}
                  onChange={(option) =>
                    patchSpeech({ model: option?.id || "" })
                  }
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                disabled={!speechOn || speechBusy}
                onClick={loadSpeechModels}
                title="Обновить список моделей"
                aria-label="Обновить список моделей распознавания"
              >
                <RiRefreshLine
                  className={speechBusy ? "tw:animate-spin" : undefined}
                />
              </Button>
            </div>
          </SettingRow>
        </>
      )}
    </SectionForm>
  );
};

export default PrefsAi;
