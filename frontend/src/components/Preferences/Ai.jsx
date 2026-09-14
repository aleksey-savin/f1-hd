import { useEffect, useState } from "react";

import { RiRefreshLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { cn } from "@/lib/utils";
import HealthRow from "@/components/app/HealthRow";
import { SubLabel } from "@/components/app/Panel";

import Combobox, { toOptions } from "@/components/app/Combobox";
import SectionForm from "./SectionForm";
import AiRules from "./AiRules";
import { describeChannelHealth, describeCheckResult } from "./channel-health";

// «Искусственный интеллект» — канон «селектор → условный блок»: мастер-свитч,
// провайдер, его поля. Каталог моделей у всех провайдеров живой: подгружается
// по ключу (у Yandex AI Studio — по ключу и каталогу) кнопкой обновления,
// сохранённая модель остаётся выбираемой, даже если её нет в свежем списке.
// Секция владеет группой ai целиком.
//
// Каналов наружу здесь два — чат-провайдер и распознавание речи, у каждого свой
// ключ и своя строка состояния: включённый свитч это намерение, а не факт.
//
// «Локальная модель» — один пункт на все self-hosted сервисы: Ollama, LM Studio,
// vLLM, llama.cpp и LocalAI отдают один и тот же OpenAI-совместимый /v1 и
// различаются только адресом. Отдельные пункты на каждый продукт были бы
// одинаковыми формами с разными подписями.
const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "yandexai", label: "Yandex AI Studio" },
  { value: "local", label: "Локальная модель" },
];
const SPEECH_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "yandex", label: "Yandex SpeechKit" },
  { value: "local", label: "Локальная модель" },
];

// Основной провайдер, у которого распознавание может взять ключ и адрес.
// Пары не произвольные: у OpenAI ключ один на чат и расшифровку, у Яндекса один
// ключ Cloud открывает и AI Studio, и SpeechKit, локальный сервер — это один
// адрес. Чат в Anthropic и расшифровка в OpenAI общего не имеют вовсе.
// Зеркало CREDENTIALS_SOURCE в backend/services/speechToTextService.js.
const CREDENTIALS_SOURCE = {
  openai: "openai",
  yandex: "yandexai",
  local: "local",
};
const canShareCredentials = (chatProvider, speechProvider) =>
  CREDENTIALS_SOURCE[speechProvider] === chatProvider;

const DEFAULT_AI = {
  isActive: false,
  provider: "openai",
  openai: { apiKey: "", model: "" },
  anthropic: { apiKey: "", model: "" },
  deepseek: { apiKey: "", model: "deepseek-chat" },
  // Каталог у каждого арендатора свой — дефолтное имя модели было бы угадыванием
  yandexai: { apiKey: "", folderId: "", model: "" },
  local: { baseUrl: "", apiKey: "", model: "" },
  // Функции по одной; отсутствие флага в старых настройках = включено
  features: {
    category: true,
    title: true,
    guide: true,
    terms: true,
    feedback: true,
  },
  speechToText: {
    isActive: false,
    callSummary: true,
    provider: "openai",
    useProviderCredentials: false,
    apiKey: "",
    model: "gpt-4o-transcribe-diarize",
    yandex: { apiKey: "", folderId: "", model: "general" },
    local: { baseUrl: "", apiKey: "", model: "" },
  },
};

// «Функции»: что поручено модели, по одной. Главный свитч — только подключение.
// Расшифровка и описание из звонка лежат в speechToText (у распознавания свой
// канал и ключ), остальные — в features. Зеркало AI_FEATURE_LABELS в
// backend/services/ai/features.js.
const FEATURES = [
  {
    key: "category",
    title: "Подбор категории",
    hint: "Автоматически, если заявка пришла без категории — с портала, из Telegram или почты.",
  },
  {
    key: "title",
    title: "Тема заявки по описанию",
    hint: "Автоматически, если заявитель не написал тему. Портал и Telegram.",
  },
  {
    key: "guide",
    title: "Руководство ИИ",
    hint: "По кнопке в карточке заявки: шаги решения или вопросы заявителю.",
  },
  {
    key: "terms",
    title: "Понятия в заявке",
    hint: "По кнопке в карточке заявки: термины подчёркиваются, по клику — справка.",
  },
  {
    key: "speechToText",
    title: "Расшифровка аудио",
    hint: "Голосовые и записи звонков — в текст. Сервис распознавания настраивается ниже.",
  },
  {
    key: "callSummary",
    parent: "speechToText",
    title: "Описание из записи звонка",
    hint: "Работает поверх расшифровки: письмо облачной АТС заменяется итогом разговора и темой.",
  },
  {
    key: "feedback",
    title: "Замечания к ИИ",
    hint: "Метка ✦ у заполненного ИИ поля принимает поправки; включённые правила уходят в запросы.",
  },
];

// Ветка дерева у вложенной функции: «Описание из записи звонка» живёт поверх
// расшифровки — отступ с уголком показывает, от чего она зависит
const NESTED_ROW =
  "relative ps-11 before:absolute before:start-7 before:top-0.5 before:bottom-1/2 before:w-2.5 before:rounded-bl-md before:border-b before:border-l before:border-border before:content-[''] max-md:before:bottom-auto max-md:before:h-3";

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
      yandexai: { ...DEFAULT_AI.yandexai, ...(stored.yandexai || {}) },
      local: { ...DEFAULT_AI.local, ...(stored.local || {}) },
      features: { ...DEFAULT_AI.features, ...(stored.features || {}) },
      speechToText: {
        ...DEFAULT_AI.speechToText,
        ...(stored.speechToText || {}),
        yandex: {
          ...DEFAULT_AI.speechToText.yandex,
          ...(stored.speechToText?.yandex || {}),
        },
        local: {
          ...DEFAULT_AI.speechToText.local,
          ...(stored.speechToText?.local || {}),
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
  const patchSpeechGroup = (key, patch) =>
    setAi((current) => ({
      ...current,
      speechToText: {
        ...current.speechToText,
        [key]: { ...current.speechToText[key], ...patch },
      },
    }));
  const patchSpeechYandex = (patch) => patchSpeechGroup("yandex", patch);
  const featureOn = (key) =>
    key === "speechToText"
      ? !!ai.speechToText.isActive
      : key === "callSummary"
        ? ai.speechToText.callSummary !== false
        : ai.features?.[key] !== false;
  const setFeature = (key, value) => {
    if (key === "speechToText") return patchSpeech({ isActive: value });
    if (key === "callSummary") return patchSpeech({ callSummary: value });
    setAi((current) => ({
      ...current,
      features: { ...current.features, [key]: value },
    }));
  };
  const patchSpeechLocal = (patch) => patchSpeechGroup("local", patch);

  // Каталоги моделей (чат и распознавание) — по требованию, с ошибкой у поля
  const [models, setModels] = useState([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [speechModels, setSpeechModels] = useState([]);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiCheckResult, setAiCheckResult] = useState(null);
  const [speechChecking, setSpeechChecking] = useState(false);
  const [speechCheckResult, setSpeechCheckResult] = useState(null);

  const fetchModels = async ({
    provider,
    apiKey,
    feature,
    folderId,
    baseUrl,
  }) => {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/preferences/ai-models`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, apiKey, feature, folderId, baseUrl }),
      },
    );
    if (!response.ok) throw new Error();
    return (await response.json()).models || [];
  };

  // Проверка канала: результат живёт до перезагрузки страницы и перекрывает
  // сохранённое состояние — он свежее. Пустой ключ бэкенд подставит сам.
  const runCheck = async (path, payload, setBusy, setResult) => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/preferences/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error();
      setResult(await response.json());
    } catch {
      setResult({
        ok: false,
        state: "Не удалось выполнить проверку",
        hint: "Сервер приложения не ответил — попробуйте ещё раз.",
      });
    } finally {
      setBusy(false);
    }
  };

  const provider = ai.provider;
  const providerConf = ai[provider] || {};
  const isLocal = provider === "local";

  // Сохранённые ключи наружу не отдаются — форма получает только флаг «задан»
  // и рисует маску; пустое поле означает «не менять», а каталог моделей бэкенд
  // подтянет по сохранённому ключу.
  const providerKeyIsSet = !!prefs.ai?.[provider]?.apiKeyIsSet;
  const speechKeyIsSet = !!prefs.ai?.speechToText?.apiKeyIsSet;
  const speechYandexKeyIsSet = !!prefs.ai?.speechToText?.yandex?.apiKeyIsSet;
  const speechLocalKeyIsSet = !!prefs.ai?.speechToText?.local?.apiKeyIsSet;

  const loadChatModels = async () => {
    // Локальному серверу ключ не нужен — ему нужен адрес
    if (isLocal && !providerConf.baseUrl) {
      setModels([]);
      setModelsError("Сначала укажите адрес сервера");
      return;
    }
    if (!isLocal && !providerConf.apiKey && !providerKeyIsSet) {
      setModels([]);
      setModelsError("Сначала укажите API-ключ");
      return;
    }
    if (provider === "yandexai" && !providerConf.folderId) {
      setModels([]);
      setModelsError("Сначала укажите идентификатор каталога");
      return;
    }
    setModelsBusy(true);
    setModelsError(null);
    try {
      setModels(
        await fetchModels({
          provider,
          apiKey: providerConf.apiKey,
          folderId: providerConf.folderId,
          baseUrl: providerConf.baseUrl,
        }),
      );
    } catch {
      setModels([]);
      setModelsError("Не удалось загрузить список моделей");
    } finally {
      setModelsBusy(false);
    }
  };

  const speech = ai.speechToText;
  const speechIsLocal = speech.provider === "local";
  // Данные берём у основного провайдера, только если ему есть что дать
  const speechShared =
    !!speech.useProviderCredentials &&
    canShareCredentials(provider, speech.provider);
  // Блок полей у каждого провайдера свой, а у OpenAI ключ и модель лежат прямо
  // в speechToText — исторически, без вложенной группы
  const speechConf = speechIsLocal
    ? speech.local
    : speech.provider === "yandex"
      ? speech.yandex
      : speech;
  const patchSpeechConf = speechIsLocal
    ? patchSpeechLocal
    : speech.provider === "yandex"
      ? patchSpeechYandex
      : patchSpeech;

  const loadSpeechModels = async () => {
    const yandex = speech.provider === "yandex";
    const apiKey = speechShared ? "" : speechConf.apiKey;
    const baseUrl = speechShared ? "" : speech.local.baseUrl;
    if (speechIsLocal && !speechShared && !baseUrl) {
      setSpeechModels([]);
      setSpeechError("Сначала укажите адрес сервера");
      return;
    }
    if (
      !apiKey &&
      !speechKeyIsSet &&
      !yandex &&
      !speechIsLocal &&
      !speechShared
    ) {
      setSpeechModels([]);
      setSpeechError("Сначала укажите API-ключ");
      return;
    }
    setSpeechBusy(true);
    setSpeechError(null);
    try {
      setSpeechModels(
        await fetchModels({
          provider: speech.provider,
          apiKey,
          baseUrl,
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
  const featuresOnCount = FEATURES.filter(
    (feature) =>
      featureOn(feature.key) && (!feature.parent || featureOn(feature.parent)),
  ).length;
  const speechOn = aiOn && !!speech.isActive;
  const dim = aiOn ? "py-3" : "py-3 opacity-60";
  const dimSpeech = speechOn ? "py-3" : "py-3 opacity-60";

  const chatModelOptions = withCurrent(models, providerConf.model);
  const speechModelOptions = withCurrent(speechModels, speechConf.model);

  const chatHealth = aiChecking
    ? { state: "busy", title: "Спрашиваем модель…" }
    : aiCheckResult
      ? describeCheckResult(aiCheckResult)
      : describeChannelHealth(prefs.ai?.health, { kind: "ai" });

  const speechHealth = speechChecking
    ? { state: "busy", title: "Проверяем распознавание…" }
    : speechCheckResult
      ? describeCheckResult(speechCheckResult)
      : describeChannelHealth(prefs.ai?.speechToText?.health, {
          kind: "speech",
        });

  return (
    <>
      <SectionForm buildPayload={() => ({ ai })}>
        <SettingRow
          title="Использовать ИИ"
          hint="Подключение к модели. Что ей поручать — в «Функциях»."
          htmlFor="prefs-ai-enabled"
        >
          <Switch
            id="prefs-ai-enabled"
            checked={aiOn}
            onCheckedChange={(value) => patchTop({ isActive: value })}
          />
        </SettingRow>
        <SettingRow
          divider
          title="Провайдер"
          htmlFor="prefs-ai-provider"
          className={dim}
        >
          <div className="w-56 max-md:w-full">
            <Combobox
              id="prefs-ai-provider"
              disabled={!aiOn}
              value={provider}
              options={PROVIDERS}
              onChange={(value) => patchTop({ provider: value || "openai" })}
            />
          </div>
        </SettingRow>
        {isLocal && (
          <SettingRow
            title="Адрес сервера"
            hint="Ollama, LM Studio, vLLM, llama.cpp — любой OpenAI-совместимый сервер. Путь /v1 допишем сами."
            htmlFor="prefs-ai-base-url"
            className={dim}
          >
            <Input
              id="prefs-ai-base-url"
              type="text"
              disabled={!aiOn}
              placeholder="http://192.168.1.10:11434"
              value={providerConf.baseUrl || ""}
              onChange={(event) =>
                patchProvider(provider, { baseUrl: event.target.value })
              }
              className="w-72 max-md:w-full"
            />
          </SettingRow>
        )}
        <SettingRow
          title={
            isLocal
              ? "API-ключ"
              : `API-ключ ${PROVIDERS.find((option) => option.value === provider)?.label}`
          }
          hint={
            providerKeyIsSet
              ? "Оставьте поле пустым, чтобы не менять."
              : isLocal
                ? "Ollama и LM Studio ключа не спрашивают — оставьте пустым. Заполните, если сервер закрыт прокси с авторизацией."
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
            className="w-72 max-md:w-full"
            autoComplete="new-password"
          />
        </SettingRow>
        {provider === "yandexai" && (
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
              className="w-72 max-md:w-full"
            />
          </SettingRow>
        )}
        <SettingRow
          title="Модель"
          hint={
            modelsError ||
            (isLocal
              ? "Список подгружается с сервера."
              : provider === "yandexai"
                ? "Список подгружается по ключу и каталогу."
                : "Список подгружается по ключу.")
          }
          htmlFor="prefs-ai-model"
          className={dim}
        >
          <div className="flex items-center gap-2">
            <div className="w-64 max-md:w-full">
              <Combobox
                id="prefs-ai-model"
                placeholder="— загрузите список —"
                disabled={!aiOn}
                value={providerConf.model || null}
                options={toOptions(chatModelOptions, {
                  value: (option) => option.id,
                  label: (option) => option.name,
                })}
                onChange={(value) =>
                  patchProvider(provider, { model: value || "" })
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
                className={modelsBusy ? "animate-spin" : undefined}
              />
            </Button>
          </div>
        </SettingRow>

        {aiOn && (
          <HealthRow
            {...chatHealth}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={aiChecking}
                onClick={() =>
                  runCheck("ai/check", { ai }, setAiChecking, setAiCheckResult)
                }
              >
                <RiRefreshLine
                  className={aiChecking ? "animate-spin" : undefined}
                />
                Проверить
              </Button>
            }
          />
        )}

        <div className="px-5 pt-4">
          <SubLabel count={`${featuresOnCount} из ${FEATURES.length}`}>
            Функции
          </SubLabel>
        </div>
        {FEATURES.map((feature) => {
          const blocked =
            !aiOn || (feature.parent && !featureOn(feature.parent));
          return (
            <SettingRow
              key={feature.key}
              title={feature.title}
              hint={feature.hint}
              htmlFor={`prefs-ai-feature-${feature.key}`}
              className={cn(
                "py-3",
                feature.parent && NESTED_ROW,
                blocked && "opacity-60",
              )}
            >
              <Switch
                id={`prefs-ai-feature-${feature.key}`}
                disabled={blocked}
                checked={featureOn(feature.key)}
                onCheckedChange={(value) => setFeature(feature.key, value)}
              />
            </SettingRow>
          );
        })}

        {/* Сервис распознавания нужен только расшифровке — пока она выключена,
            его поля не занимают полотно */}
        {speech.isActive && (
          <>
            <div className="px-5 pt-4">
              <SubLabel>Распознавание речи</SubLabel>
            </div>
            <SettingRow
              title="Провайдер распознавания"
              htmlFor="prefs-speech-provider"
              className={dimSpeech}
            >
              <div className="w-56 max-md:w-full">
                <Combobox
                  id="prefs-speech-provider"
                  disabled={!speechOn}
                  value={speech.provider}
                  options={SPEECH_PROVIDERS}
                  onChange={(value) => patchSpeech({ provider: value || "openai" })}
                />
              </div>
            </SettingRow>
            <SettingRow
              title="Использовать данные основного провайдера"
              hint={
                canShareCredentials(provider, speech.provider)
                  ? `Ключ${speechIsLocal ? " и адрес" : ""} возьмём из блока выше — заводить их второй раз не нужно.`
                  : `${PROVIDERS.find((option) => option.value === provider)?.label} не умеет распознавать речь — данные нужны свои.`
              }
              htmlFor="prefs-speech-shared"
              className={dimSpeech}
            >
              <Switch
                id="prefs-speech-shared"
                disabled={
                  !speechOn || !canShareCredentials(provider, speech.provider)
                }
                checked={speechShared}
                onCheckedChange={(value) =>
                  patchSpeech({ useProviderCredentials: value })
                }
              />
            </SettingRow>

            {!speechShared && speechIsLocal && (
              <SettingRow
                title="Адрес сервера"
                hint="faster-whisper-server, speaches, LocalAI, vLLM — любой сервер с OpenAI-совместимым /v1/audio/transcriptions. Ollama аудио не расшифровывает."
                htmlFor="prefs-speech-base-url"
                className={dimSpeech}
              >
                <Input
                  id="prefs-speech-base-url"
                  type="text"
                  disabled={!speechOn}
                  placeholder="http://192.168.1.10:8000"
                  value={speech.local.baseUrl || ""}
                  onChange={(event) =>
                    patchSpeechLocal({ baseUrl: event.target.value })
                  }
                  className="w-72 max-md:w-full"
                />
              </SettingRow>
            )}

            {!speechShared && (
              <SettingRow
                title={
                  speech.provider === "yandex"
                    ? "API-ключ Yandex SpeechKit"
                    : speechIsLocal
                      ? "API-ключ"
                      : "API-ключ OpenAI"
                }
                hint={
                  (
                    speech.provider === "yandex"
                      ? speechYandexKeyIsSet
                      : speechIsLocal
                        ? speechLocalKeyIsSet
                        : speechKeyIsSet
                  )
                    ? "Оставьте поле пустым, чтобы не менять."
                    : speechIsLocal
                      ? "Локальные серверы ключа обычно не спрашивают — оставьте пустым."
                      : undefined
                }
                htmlFor="prefs-speech-key"
                className={dimSpeech}
              >
                <Input
                  id="prefs-speech-key"
                  type="password"
                  disabled={!speechOn}
                  placeholder={
                    (
                      speech.provider === "yandex"
                        ? speechYandexKeyIsSet
                        : speechIsLocal
                          ? speechLocalKeyIsSet
                          : speechKeyIsSet
                    )
                      ? "••••••••  (задан)"
                      : ""
                  }
                  value={speechConf.apiKey || ""}
                  onChange={(event) =>
                    patchSpeechConf({ apiKey: event.target.value })
                  }
                  className="w-72 max-md:w-full"
                  autoComplete="new-password"
                />
              </SettingRow>
            )}

            {!speechShared && speech.provider === "yandex" && (
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
                  className="w-72 max-md:w-full"
                />
              </SettingRow>
            )}

            {/* У SpeechKit каталог из одной модели — выбирать не из чего */}
            {speech.provider !== "yandex" && (
              <SettingRow
                title="Модель распознавания"
                hint={
                  speechError ||
                  (speechIsLocal
                    ? "Список подгружается с сервера."
                    : "Список подгружается по ключу.")
                }
                htmlFor="prefs-speech-model"
                className={dimSpeech}
              >
                <div className="flex items-center gap-2">
                  <div className="w-64 max-md:w-full">
                    <Combobox
                      id="prefs-speech-model"
                      placeholder="— загрузите список —"
                      disabled={!speechOn}
                      value={speechConf.model || null}
                      options={toOptions(speechModelOptions, {
                        value: (option) => option.id,
                        label: (option) => option.name,
                      })}
                      onChange={(value) => patchSpeechConf({ model: value || "" })}
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
                      className={speechBusy ? "animate-spin" : undefined}
                    />
                  </Button>
                </div>
              </SettingRow>
            )}

            {speechOn && (
              <HealthRow
                {...speechHealth}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={speechChecking}
                    onClick={() =>
                      runCheck(
                        "ai/speech-check",
                        // Группа целиком: с общими данными проверка смотрит и на
                        // основного провайдера
                        { ai },
                        setSpeechChecking,
                        setSpeechCheckResult,
                      )
                    }
                  >
                    <RiRefreshLine
                      className={speechChecking ? "animate-spin" : undefined}
                    />
                    Проверить
                  </Button>
                }
              />
            )}
          </>
        )}
      </SectionForm>

      {/* Правила формы не касаются: их пишут на карточках заявок, а здесь
          администратор только решает, пускать ли их в промпты */}
      <AiRules aiOn={aiOn} feedbackOn={aiOn && featureOn("feedback")} />
    </>
  );
};

export default PrefsAi;
