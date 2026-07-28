import { useState } from "react";

import { Button } from "@/components/ui/button";

import CategoryFixDialog from "./CategoryFixDialog";
import ReportWorksTable from "./ReportWorksTable";

/**
 * Работы, не попавшие ни под одну услугу компании.
 *
 * Показываются ТОЙ ЖЕ таблицей, что и остальные работы: своего вида у них
 * нет — это те же работы, просто категория их заявки не привязана ни к одной
 * услуге. Отличие ровно одно — действие в конце строки, потому что они
 * блокируют формирование отчёта и чинить их надо здесь же.
 */
const UnrelatedWorks = ({
  works,
  onFixed,
}: {
  works: any[];
  onFixed: () => void;
}) => {
  const [queue, setQueue] = useState<any[] | null>(null);

  return (
    <>
      <ReportWorksTable
        works={works}
        tone="warning"
        action={(work) => (
          <Button size="sm" variant="outline" onClick={() => setQueue([work])}>
            Сменить категорию
          </Button>
        )}
        footnote={
          <>
            <b className="tw:font-semibold">
              Пока эти работы здесь, отчёт не сформировать.
            </b>{" "}
            Категория их заявок не входит ни в одну услугу компании — смените её
            на ту, что привязана к нужной услуге, и работа сразу попадёт в
            расчёт.
          </>
        }
      />

      <CategoryFixDialog
        works={queue || []}
        open={Boolean(queue)}
        onOpenChange={(open) => !open && setQueue(null)}
        onFixed={onFixed}
      />
    </>
  );
};

export default UnrelatedWorks;
