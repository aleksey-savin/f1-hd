import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";
import SectionForm from "./SectionForm";

/**
 * Настройки заявок: правила их жизни в одном месте.
 *
 * Срок выполнения и обе строки про чек-листы переехали сюда из «Основных» — там
 * они жили между часовым поясом и логотипом организации, хотя описывают заявку,
 * а не арендатора.
 *
 * Подгруппа «Давно без движения» — правила одноимённого среза на главной
 * (`Dashboard/StaffTickets`). Считает их бэкенд: рабочие дни знает
 * производственный календарь, а движение по заявке берётся из её хроники
 * (`services/ticketActivity`).
 */
const PrefsTickets = ({ prefs }) => {
  const [deadline, setDeadline] = useState(prefs.deadline ?? 10);
  const [autoApplyChecklists, setAutoApplyChecklists] = useState(
    prefs.checklistTemplates?.autoApply ?? false,
  );

  const stale = prefs.staleTickets || {};
  const [thresholdDays, setThresholdDays] = useState(stale.thresholdDays ?? 7);
  const [ignoreAuto, setIgnoreAuto] = useState(stale.ignoreAuto ?? true);
  const [ignoreUnassigned, setIgnoreUnassigned] = useState(
    stale.ignoreUnassigned ?? true,
  );

  return (
    <SectionForm
      buildPayload={() => ({
        deadline: Number(deadline) || 0,
        checklistTemplates: { autoApply: autoApplyChecklists },
        staleTickets: {
          thresholdDays: Number(thresholdDays) || 7,
          ignoreAuto,
          ignoreUnassigned,
        },
      })}
    >
      <SettingRow
        title="Срок выполнения по умолчанию"
        hint="Дедлайн новой заявки, если не указан вручную."
        htmlFor="prefs-deadline"
      >
        <div className="flex items-center gap-2">
          <Input
            id="prefs-deadline"
            type="number"
            min="1"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className="w-24 text-right"
          />
          <span className="text-sm text-muted-foreground">часов</span>
        </div>
      </SettingRow>

      <SettingRow
        divider
        title="Автоматически добавлять шаблоны чек-листов"
        hint="При создании заявки подходящий шаблон применяется сам. Побеждает самый узкий: сначала «категория и компания», затем «компания», затем «категория». Выключено — карточка предлагает шаблон строкой."
        htmlFor="prefs-checklist-autoapply"
      >
        <Switch
          id="prefs-checklist-autoapply"
          checked={autoApplyChecklists}
          onCheckedChange={setAutoApplyChecklists}
        />
      </SettingRow>

      <div className="border-t border-border-soft px-5 pt-4">
        <SubLabel>Давно без движения</SubLabel>
      </div>

      <SettingRow
        title="Заявка без движения дольше"
        hint="Комментарии, работы, смена статуса или ответственного."
        htmlFor="prefs-stale-days"
      >
        <div className="flex items-center gap-2">
          <Input
            id="prefs-stale-days"
            type="number"
            min="1"
            max="60"
            value={thresholdDays}
            onChange={(event) => setThresholdDays(event.target.value)}
            className="w-24 text-right"
          />
          <span className="text-sm text-muted-foreground">рабочих дней</span>
        </div>
      </SettingRow>

      {/* Подсказок у переключателей нет намеренно: названия себя объясняют, а
          абзац под каждым свитчем превращает секцию в простыню. */}
      <SettingRow
        divider
        title="Не учитывать машинные заявки"
        htmlFor="prefs-stale-auto"
      >
        <Switch
          id="prefs-stale-auto"
          checked={ignoreAuto}
          onCheckedChange={setIgnoreAuto}
        />
      </SettingRow>

      <SettingRow
        divider
        title="Не учитывать заявки без ответственного"
        htmlFor="prefs-stale-unassigned"
      >
        <Switch
          id="prefs-stale-unassigned"
          checked={ignoreUnassigned}
          onCheckedChange={setIgnoreUnassigned}
        />
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsTickets;
