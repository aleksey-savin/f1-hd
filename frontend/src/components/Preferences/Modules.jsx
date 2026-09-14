import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import HealthRow from "@/components/app/HealthRow";
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
    mikrotik: !!prefs.modules?.mikrotik?.isActive,
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
          mikrotik: { isActive: modules.mikrotik },
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
      <SettingRow
        title="Мониторинг Mikrotik"
        htmlFor="prefs-module-mikrotik"
        className="py-3"
      >
        <Switch
          id="prefs-module-mikrotik"
          checked={modules.mikrotik}
          onCheckedChange={(value) => toggle("mikrotik", value)}
        />
      </SettingRow>
      {/* Пояснение устройства — той же полосой, что состояние канала:
          заливная плашка была третьим видом одного и того же сообщения */}
      <HealthRow
        state="info"
        title="Выключенный модуль скрывает свои разделы у всех и свои секции на этой странице"
      />
    </SectionForm>
  );
};

export default PrefsModules;
