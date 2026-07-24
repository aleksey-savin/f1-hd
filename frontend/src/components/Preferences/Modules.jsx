import { useState } from "react";

import { RiInformationLine } from "react-icons/ri";

import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";

import SectionForm from "./SectionForm";

// «Модули»: функциональные области приложения. Выключенный модуль скрывает
// свои разделы у всех пользователей и свои секции на этой странице.
// «Учёт финансов» работает поверх «Учёта времени» — бэкенд гасит его сам,
// UI показывает зависимость блокировкой свитча.
const PrefsModules = ({ prefs }) => {
  const [modules, setModules] = useState(() => ({
    timeTracking: !!prefs.modules?.timeTracking?.isActive,
    finances: !!prefs.modules?.finances?.isActive,
    inventory: !!prefs.modules?.inventory?.isActive,
    knowledgeBase: !!prefs.modules?.knowledgeBase?.isActive,
  }));

  const toggle = (key, value) =>
    setModules((current) => ({
      ...current,
      [key]: value,
      // финансы без учёта времени не работают
      ...(key === "timeTracking" && !value ? { finances: false } : {}),
    }));

  return (
    <SectionForm
      buildPayload={() => ({
        modules: {
          timeTracking: { isActive: modules.timeTracking },
          finances: { isActive: modules.finances },
          inventory: { isActive: modules.inventory },
          knowledgeBase: { isActive: modules.knowledgeBase },
        },
      })}
    >
      <SettingRow
        title="База знаний"
        htmlFor="prefs-module-kb"
        className="tw:py-3"
      >
        <Switch
          id="prefs-module-kb"
          checked={modules.knowledgeBase}
          onCheckedChange={(value) => toggle("knowledgeBase", value)}
        />
      </SettingRow>
      <SettingRow
        title="Учёт времени"
        htmlFor="prefs-module-time"
        className="tw:py-3"
      >
        <Switch
          id="prefs-module-time"
          checked={modules.timeTracking}
          onCheckedChange={(value) => toggle("timeTracking", value)}
        />
      </SettingRow>
      <SettingRow
        title="Учёт финансов"
        hint="Работает поверх учёта времени."
        htmlFor="prefs-module-finances"
        className={modules.timeTracking ? "tw:py-3" : "tw:py-3 tw:opacity-60"}
      >
        <Switch
          id="prefs-module-finances"
          disabled={!modules.timeTracking}
          checked={modules.finances}
          onCheckedChange={(value) => toggle("finances", value)}
        />
      </SettingRow>
      <SettingRow
        title="Учёт техники"
        htmlFor="prefs-module-inventory"
        className="tw:py-3"
      >
        <Switch
          id="prefs-module-inventory"
          checked={modules.inventory}
          onCheckedChange={(value) => toggle("inventory", value)}
        />
      </SettingRow>
      <div className="tw:mx-5 tw:my-3 tw:flex tw:items-start tw:gap-2.5 tw:rounded-lg tw:bg-primary/10 tw:px-4 tw:py-3 tw:text-sm tw:text-accent-text">
        <RiInformationLine size={16} aria-hidden className="tw:mt-0.5 tw:flex-none" />
        Выключенный модуль скрывает свои разделы у всех пользователей и свои
        секции на этой странице.
      </div>
    </SectionForm>
  );
};

export default PrefsModules;
