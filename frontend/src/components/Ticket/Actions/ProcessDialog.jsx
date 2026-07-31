import { useCallback, useEffect, useState } from "react";

import Field from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import useHttp from "../../../hooks/use-http";
import useTicketAction from "../../../hooks/use-ticket-action";
import { getLocalStorageData } from "../../../util/auth";
import { localToUtc, utcToLocalForm } from "../../../util/format-date";
import Select from "../../../UI/Select";

/**
 * «Обработать» — единственное действие с полноценной формой: диспетчер
 * проверяет и правит тему, компанию, инициатора, категорию и срок, назначает
 * ответственных, и только после этого заявка уходит в работу.
 *
 * Поэтому оно не в общем ActionDialog: у остальных действий одно поле, а тут их
 * шесть, и половина зависит друг от друга (список инициаторов сужается выбранной
 * компанией, подсветка ответственных — выбранной категорией).
 */
const ProcessDialog = ({ ticket, open, onClose }) => {
  const fetcher = useTicketAction();
  const { token } = getLocalStorageData();
  const { sendRequest } = useHttp();

  const [formData, setFormData] = useState({});
  const [title, setTitle] = useState(ticket.title ?? "");
  const [description, setDescription] = useState(ticket.description ?? "");
  const [company, setCompany] = useState(ticket.company ?? null);
  const [applicant, setApplicant] = useState(ticket.applicant ?? null);
  const [category, setCategory] = useState(ticket.category ?? null);
  const [responsibles, setResponsibles] = useState([]);
  const [deadline, setDeadline] = useState(
    ticket.deadline ? utcToLocalForm(ticket.deadline) : "",
  );

  const load = useCallback(() => {
    if (!open) return;
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data`,
        headers: { Authorization: "Bearer " + token },
      },
      (data) => setFormData(data ?? {}),
    );
  }, [open, sendRequest, token]);

  useEffect(() => {
    load();
  }, [load]);

  // Инициаторы — сотрудники выбранной компании плюс те, кто ведёт заявки:
  // заявку заводят и на коллегу, и на клиента
  const applicants = (formData.applicants ?? []).filter(
    (user) =>
      user.permissions?.canAdministrateTickets ||
      user.permissions?.canPerformTickets ||
      user.company?._id?.toString() === company?._id?.toString(),
  );

  const submit = (event) => {
    event.preventDefault();
    const payload = new FormData();
    payload.append("intent", "process");
    payload.append("_id", ticket._id);
    payload.append("num", ticket.num);
    payload.append("title", title);
    payload.append("description", description);
    payload.append("company", JSON.stringify(company));
    payload.append("categoryId", category?._id ?? "");
    payload.append("applicantId", applicant?._id ?? "");
    payload.append("responsibles", JSON.stringify(responsibles));
    // Настенное время в бизнес-таймзоне: сырую строку без зоны сервер
    // разобрал бы как UTC
    payload.append("deadline", deadline ? localToUtc(deadline) : "");
    payload.append("expectedVersion", ticket.version ?? "");

    fetcher.submit(payload, {
      method: "POST",
      action: `/tickets/${ticket.num}`,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="tw:sm:max-w-2xl">
        <form
          onSubmit={submit}
          className="tw:flex tw:max-h-[80dvh] tw:flex-col"
        >
          <DialogHeader>
            <DialogTitle>Обработать заявку</DialogTitle>
            <DialogDescription>
              Заявка № {ticket.num} · проверьте данные и назначьте ответственных
            </DialogDescription>
          </DialogHeader>

          <div className="tw:mt-4 tw:flex-1 tw:overflow-y-auto tw:pe-1">
            <Field label="Тема" htmlFor="process-title" required>
              <Input
                id="process-title"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
              <Field label="Компания" htmlFor="process-company" required>
                <Select
                  id="process-company"
                  placeholder="Выберите компанию"
                  isClearable
                  isSearchable
                  options={formData.companies}
                  value={company}
                  getOptionLabel={(option) => option.alias}
                  getOptionValue={(option) => option._id}
                  onChange={setCompany}
                />
              </Field>

              <Field label="Инициатор" htmlFor="process-applicant" required>
                <Select
                  id="process-applicant"
                  placeholder="Выберите пользователя"
                  isClearable
                  isSearchable
                  options={applicants}
                  value={applicant}
                  getOptionLabel={(option) =>
                    `${option.lastName} ${option.firstName}`
                  }
                  getOptionValue={(option) => option._id}
                  onChange={setApplicant}
                />
              </Field>
            </div>

            {!ticket.description && (
              <Field label="Описание" htmlFor="process-description" required>
                <Textarea
                  id="process-description"
                  rows={5}
                  required
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            )}

            <Field
              label="Категория"
              htmlFor="process-category"
              required
              hint={category?.description || "У категории нет описания"}
            >
              <Select
                id="process-category"
                placeholder="Выберите категорию"
                isClearable
                isSearchable
                options={formData.categories}
                value={category}
                getOptionLabel={(option) => option.title}
                getOptionValue={(option) => option._id}
                onChange={setCategory}
              />
            </Field>

            <Field
              label="Ответственные"
              htmlFor="process-responsibles"
              hint="Зелёным — те, кто ведёт выбранную категорию"
            >
              <Select
                id="process-responsibles"
                placeholder="Выберите пользователей"
                isMulti
                isClearable
                isSearchable
                closeMenuOnSelect={false}
                options={formData.responsibles}
                value={responsibles}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option._id}
                onChange={(selected) => setResponsibles(selected ?? [])}
                formatOptionLabel={(option) => (
                  <span
                    className={
                      category?.users?.some((user) => user._id === option._id)
                        ? "tw:text-accent-text"
                        : "tw:text-warning"
                    }
                  >
                    {option.lastName} {option.firstName}
                  </span>
                )}
              />
            </Field>

            <Field label="Срок" htmlFor="process-deadline">
              <Input
                id="process-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </Field>
          </div>

          <DialogFooter className="tw:mt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              Обработать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ProcessDialog;
