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
        className="py-3"
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
        className="py-3"
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
        className={modules.timeTracking ? "py-3" : "py-3 opacity-60"}
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
        className="py-3"
      >
        <Switch
          id="prefs-module-inventory"
          checked={modules.inventory}
          onCheckedChange={(value) => toggle("inventory", value)}
        />
      </SettingRow>
      <div className="mx-5 my-3 flex items-start gap-2.5 rounded-lg bg-primary/10 px-4 py-3 text-sm text-accent-text">
        <RiInformationLine size={16} aria-hidden className="mt-0.5 flex-none" />
        Выключенный модуль скрывает свои разделы у всех пользователей и свои
        секции на этой странице.
      </div>
    </SectionForm>
  );
};

export default PrefsModules;
