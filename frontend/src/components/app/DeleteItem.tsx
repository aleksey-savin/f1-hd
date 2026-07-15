import { useState, type ReactNode } from "react";

import { Form as RouterForm } from "react-router";
import { RiDeleteBinLine } from "react-icons/ri";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type DeletableItem = {
  _id: string;
  title?: string;
  alias?: string;
};

// tw-двойник components/DeleteItem.jsx. Разделён на две части:
//  - DeleteDialog — сам диалог подтверждения (RouterForm intent=delete на
//    action текущего маршрута). Radix-меню размонтирует содержимое при
//    закрытии, поэтому из выпадающих меню диалог рендерят СНАРУЖИ меню и
//    открывают состоянием (см. ItemCard).
//  - DeleteItem (default) — самостоятельная кнопка «Удалить» + диалог
//    (бывший isButton-режим).
export function DeleteDialog({
  item,
  open,
  onOpenChange,
  customDeleteMessage = "",
}: {
  item: DeletableItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customDeleteMessage?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {/* Закрываем диалог в момент сабмита: после redirect экшена строка
            размонтируется вместе с диалогом, и открытый модальный radix
            оставляет на <body> залипший pointer-events: none — страница
            перестаёт кликаться. Сабмит роутер уже принял, удаление идёт. */}
        <RouterForm method="post" onSubmit={() => onOpenChange(false)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{item.title || item.alias}</AlertDialogTitle>
            <AlertDialogDescription>
              {customDeleteMessage || "Вы уверены? Это действие нельзя отменить."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={item._id} readOnly />
          <AlertDialogFooter className="tw:mt-4">
            <AlertDialogCancel type="button">Закрыть</AlertDialogCancel>
            <Button
              variant="destructive"
              type="submit"
              name="intent"
              value="delete"
            >
              <RiDeleteBinLine /> Удалить
            </Button>
          </AlertDialogFooter>
        </RouterForm>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const DeleteItem = ({
  item,
  customDeleteMessage = "",
}: {
  item: DeletableItem;
  customDeleteMessage?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="destructive"
        className="tw:mb-2 tw:w-full"
        onClick={() => setOpen(true)}
      >
        <RiDeleteBinLine /> Удалить
      </Button>
      <DeleteDialog
        item={item}
        open={open}
        onOpenChange={setOpen}
        customDeleteMessage={customDeleteMessage}
      />
    </>
  );
};

export default DeleteItem;
