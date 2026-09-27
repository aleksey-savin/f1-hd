import { useEffect, useState, type ComponentType } from "react";

import Combobox from "@/components/app/Combobox";
import WorkStatusAvatarJs from "@/components/User/WorkStatusAvatar";
import { presenceLine } from "@/components/User/presence";
import { load } from "@/store/form-data";
import useWorkStatusesStore from "@/store/work-statuses";
import { getWorkStatusMeta } from "@/util/work-statuses";

// Граница типизации: компонент на JS, его пропсы TS выводит обязательными
const WorkStatusAvatar = WorkStatusAvatarJs as unknown as ComponentType<{
  firstName?: string;
  lastName?: string;
  profileImagePath?: string;
  workStatus?: { code?: string } | null;
  size?: number;
  showBadge?: boolean;
}>;

type Person = {
  _id: string;
  firstName?: string;
  lastName?: string;
};

type PresenceUser = Person & {
  profileImagePath?: string;
  workStatus?: { code?: string } | null;
};

/**
 * «Ответственный за диалог» (канва A1, B3): аватар с кольцом присутствия и имя
 * в поле; список — те, кто ведёт заявки, с присутствием подсказкой, как в
 * выборе ответственных заявки. Назначенный видит диалог всегда и получает
 * колокольчик «ждёт ответа» первым.
 */
const AssigneePicker = ({
  assignee,
  disabled,
  onChange,
}: {
  assignee: { id: string; name: string } | null;
  disabled: boolean;
  onChange: (userId: string | null) => void;
}) => {
  const [people, setPeople] = useState<Person[] | null>(null);
  const presence = useWorkStatusesStore((state) => state.users) as PresenceUser[];

  useEffect(() => {
    let alive = true;
    load<Person[]>("/api/users/can-perform-tickets")
      .then((list) => {
        if (alive) setPeople(list);
      })
      .catch(() => {
        if (alive) setPeople([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const liveById = new Map(presence.map((user) => [String(user._id), user]));
  const options = (people ?? []).map((person) => {
    const live = liveById.get(String(person._id));
    const meta = live ? getWorkStatusMeta(live.workStatus?.code) : null;
    return {
      value: String(person._id),
      label: `${person.lastName ?? ""} ${person.firstName ?? ""}`.trim(),
      hint: live ? presenceLine(live) : undefined,
      dot: meta && meta.code !== "unset" ? meta.color : undefined,
    };
  });
  const selected = assignee ? liveById.get(assignee.id) : undefined;

  return (
    <Combobox
      value={assignee?.id ?? null}
      onChange={onChange}
      options={options}
      loading={people === null}
      disabled={disabled}
      clearable
      clearLabel="Не назначен"
      placeholder={assignee?.name ?? "Не назначен"}
      searchPlaceholder="Найти сотрудника…"
      emptyText="Сотрудник не нашёлся."
      ariaLabel="Ответственный за диалог"
      leading={
        assignee ? (
          <WorkStatusAvatar
            size={24}
            showBadge={false}
            firstName={selected?.firstName ?? assignee.name.split(" ")[1]}
            lastName={selected?.lastName ?? assignee.name.split(" ")[0]}
            profileImagePath={selected?.profileImagePath}
            workStatus={selected?.workStatus ?? null}
          />
        ) : undefined
      }
    />
  );
};

export default AssigneePicker;
