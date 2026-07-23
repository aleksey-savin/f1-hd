import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import { InsideOverlayContext } from "@/components/app/overlay-context";

import Select from "../../../UI/Select";

// Состав подразделения: руководитель + сотрудники. Человек может состоять
// только в одном подразделении — занятые в других помечаются и недоступны
// (карта company.usersInSubdivisions собирается loader'ом карточки).
const sortByName = (a, b) =>
  `${a.lastName} ${a.firstName}`
    .toLowerCase()
    .localeCompare(`${b.lastName} ${b.firstName}`.toLowerCase(), "ru");

const formatUserName = (user) => `${user.lastName} ${user.firstName}`;

const SubdivisionUsersDialog = ({ open, onOpenChange, node, company, fetcher }) => {
  const [manager, setManager] = useState(null);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (open && node) {
      setManager(node.manager || null);
      setUsers(node.users || []);
    }
  }, [open, node]);

  if (!node) return null;

  const options = [...(company.employees || [])].sort(sortByName);
  const busy = fetcher.state !== "idle";

  const assignmentOf = (option) => company.usersInSubdivisions?.[option._id];

  const getOptionLabel = (option) => {
    const assignment = assignmentOf(option);
    if (assignment && assignment.subdivisionId !== node._id) {
      return `${formatUserName(option)} (${
        assignment.role === "manager" ? "Руководитель" : "Сотрудник"
      } в ${assignment.subdivisionName})`;
    }
    return formatUserName(option);
  };

  const isOptionDisabled = (option) => {
    const assignment = assignmentOf(option);
    return Boolean(assignment && assignment.subdivisionId !== node._id);
  };

  const handleManagerChange = (next) => {
    if (next) setUsers((prev) => prev.filter((user) => user._id !== next._id));
    setManager(next || null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    fetcher.submit(
      {
        intent: "updateSubdivisionUsers",
        subdivisionId: node._id,
        manager: manager?._id || "",
        users: users
          .filter((user) => user && user._id)
          .map((user) => user._id)
          .join(","),
      },
      { method: "PATCH", action: `/companies/${company._id}` },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tw:max-w-lg" aria-describedby={undefined}>
        <InsideOverlayContext.Provider value={true}>
          <DialogHeader>
            <DialogTitle>
              Состав — {node.name?.trim() || "Без названия"}
            </DialogTitle>
          </DialogHeader>

          {fetcher.data?.error && (
            <AlertMessage variant="danger" message={fetcher.data.error} />
          )}

          <form onSubmit={handleSubmit}>
            <Field label="Руководитель">
              <Select
                isClearable
                placeholder="Не назначен"
                options={options}
                value={manager}
                onChange={handleManagerChange}
                getOptionLabel={getOptionLabel}
                getOptionValue={(option) => option._id}
                isOptionDisabled={isOptionDisabled}
              />
            </Field>
            <Field label="Сотрудники">
              <Select
                isMulti
                closeMenuOnSelect={false}
                placeholder="Выберите сотрудников"
                options={options}
                value={users}
                onChange={(next) => setUsers(next || [])}
                getOptionLabel={getOptionLabel}
                getOptionValue={(option) => option._id}
                isOptionDisabled={isOptionDisabled}
              />
            </Field>

            <DialogFooter className="tw:mt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </InsideOverlayContext.Provider>
      </DialogContent>
    </Dialog>
  );
};

export default SubdivisionUsersDialog;
