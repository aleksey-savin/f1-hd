import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import SectionForm from "./SectionForm";
import type { ReviewSettings } from "@/types/userReview";

export default function UserReviewPreferences({
  prefs,
}: {
  prefs: { userReview?: Partial<ReviewSettings> };
}) {
  const [enabled, setEnabled] = useState(prefs.userReview?.enabled ?? false);
  const [suggestDeletion, setSuggestDeletion] = useState(
    prefs.userReview?.suggestDeletion ?? false,
  );
  const [disabledDays, setDisabledDays] = useState(
    String(prefs.userReview?.disabledDays ?? 90),
  );
  const [inactivityDays, setInactivityDays] = useState(
    String(prefs.userReview?.inactivityDays ?? 180),
  );
  const valid = [Number(disabledDays), Number(inactivityDays)].every(
    (value) => Number.isInteger(value) && value > 0 && value <= 3650,
  );
  return (
    <SectionForm
      buildPayload={() => ({
        userReview: {
          enabled,
          suggestDeletion,
          disabledDays: Number(disabledDays),
          inactivityDays: Number(inactivityDays),
        },
      })}
      blockedReason={valid ? null : "Укажите целое число дней от 1 до 3650"}
    >
      <SettingRow
        title="Проверка пользователей"
        hint="Анализировать новые заявки и комментарии, искать упоминания увольнения и предлагать проверку учётных записей. Для анализа текста нужно подключение к ИИ."
        htmlFor="review-enabled"
      >
        <Switch
          id="review-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </SettingRow>
      <SettingRow
        divider
        title="Предлагать удаление отключённых пользователей"
        hint="Предложение появится в очереди проверки и на главной. Решение принимает сотрудник."
        htmlFor="review-deletion"
      >
        <Switch
          id="review-deletion"
          checked={suggestDeletion}
          onCheckedChange={setSuggestDeletion}
        />
      </SettingRow>
      {suggestDeletion && (
        <SettingRow
          title="Отключены более"
          hint="С даты последнего отключения. Для старых записей без даты отключения срок не угадываем."
          htmlFor="review-disabled-days"
        >
          <div className="flex items-center gap-2">
            <Input
              id="review-disabled-days"
              type="number"
              min="1"
              max="3650"
              className="w-24 text-right"
              value={disabledDays}
              onChange={(event) => setDisabledDays(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">дней</span>
          </div>
        </SettingRow>
      )}
      <SettingRow
        divider
        title="Нет активности более"
        hint="Учитываются последний вход и последняя заявка пользователя. Отсутствие входов само по себе не означает, что учётная запись больше не нужна."
        htmlFor="review-inactive-days"
      >
        <div className="flex items-center gap-2">
          <Input
            id="review-inactive-days"
            type="number"
            min="1"
            max="3650"
            className="w-24 text-right"
            value={inactivityDays}
            onChange={(event) => setInactivityDays(event.target.value)}
          />
          <span className="text-sm text-muted-foreground">дней</span>
        </div>
      </SettingRow>
    </SectionForm>
  );
}
