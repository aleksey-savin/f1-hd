import { useLoaderData, useRevalidator } from "react-router";

import {
  calculateWorkTime,
  calculateOvertime,
  filterUnrelatedWorks,
  overallRoundedWorktime,
} from "../../util/finances";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";

import Alert from "react-bootstrap/Alert";
import Table from "react-bootstrap/Table";

import UnrelatedWorksOffcanvas from "./UnrelatedWorksOffcanvas";
import TableActionBar from "./tableActionBar";
import { msToHMS } from "../../util/time-helpers";
import Button from "react-bootstrap/esm/Button";
import { RiRefreshLine } from "react-icons/ri";
import { useEffect, useState } from "react";
import Spinner from "react-bootstrap/Spinner";

const PreviewTable = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmedReports, setConfirmedReports] = useState(new Set());
  const revalidator = useRevalidator();

  const filterStore = useSummaryReportFilterStore();
  const { preview } = useLoaderData();

  const handleRefresh = () => {
    setIsRefreshing(true);
    revalidator.revalidate();
  };

  const handleOptimisticConfirm = (companyId, servicePlanId) => {
    const reportKey = `${companyId}-${servicePlanId}`;
    setConfirmedReports((prev) => new Set([...prev, reportKey]));
  };

  const splitDataByMonth = (data) => {
    const monthArrays = {};

    data.forEach((company) => {
      company.works.forEach((work) => {
        if (work.finishedAt) {
          const date = new Date(work.finishedAt);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

          if (!monthArrays[monthKey]) {
            monthArrays[monthKey] = data.map((comp) => ({
              ...comp,
              works: [],
              tickets: [],
            }));
          }

          const companyIndex = monthArrays[monthKey].findIndex(
            (c) => c.company === company.company,
          );
          if (companyIndex !== -1) {
            monthArrays[monthKey][companyIndex].works.push(work);

            // Add associated tickets
            work.tickets
              .map((ticket) => ticket._id)
              .forEach((ticketId) => {
                const ticket = company.tickets.find((t) => t._id === ticketId);
                if (
                  ticket &&
                  !monthArrays[monthKey][companyIndex].tickets.some(
                    (t) => t._id === ticketId,
                  )
                ) {
                  monthArrays[monthKey][companyIndex].tickets.push(ticket);
                }
              });
          }
        }
      });
    });

    // Remove companies with no works
    Object.keys(monthArrays).forEach((monthKey) => {
      monthArrays[monthKey] = monthArrays[monthKey].filter(
        (company) => company.works.length > 0,
      );
    });

    return Object.entries(monthArrays)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, monthData]) => monthData);
  };

  const splitData = splitDataByMonth(preview);

  const getMonthName = (UtcDate) => {
    return new Date(UtcDate)
      .toLocaleDateString("ru-Ru", { month: "long" })
      .toUpperCase();
  };

  // Вынесенная функция для расчета workingTime
  const calculateWorkingTime = (plan, relatedWorks, schedule) => {
    const tariff = plan.type;
    return tariff === "hourly"
      ? overallRoundedWorktime(relatedWorks, plan.tariffingPeriod) / (1000 * 60)
      : calculateWorkTime(schedule, relatedWorks, plan.tariffingPeriod)
          .roundedWorktime;
  };

  // Вынесенная функция для расчета цены пакета часов
  const calculateHourPackagePrice = (plan, workingTimeHours) => {
    let hourPackageHours = 0;
    let hourPackagePrice = 0;

    // Стандартный расчёт
    for (let hourPackage of plan.hourPackages) {
      if (workingTimeHours <= hourPackage.hours) {
        hourPackageHours = hourPackage.hours;
        hourPackagePrice = hourPackageHours * hourPackage.pricePerHour;
        break;
      }
    }

    if (hourPackageHours === 0 && plan.hourPackages.length > 0) {
      const lastPackage = plan.hourPackages[plan.hourPackages.length - 1];
      hourPackageHours =
        lastPackage.hours + (workingTimeHours - lastPackage.hours);
      hourPackagePrice = hourPackageHours * lastPackage.pricePerHour;
    }

    // Если клиент превысил какой-то пакет, считаем альтернативную стоимость
    if (workingTimeHours > 0) {
      let exceededPackage = null;
      for (let hourPackage of plan.hourPackages) {
        if (workingTimeHours > hourPackage.hours) {
          exceededPackage = hourPackage;
        } else {
          break;
        }
      }

      if (exceededPackage) {
        const exceededPackagePrice =
          exceededPackage.hours * exceededPackage.pricePerHour;
        const overtimeHours = workingTimeHours - exceededPackage.hours;
        const overtimePrice = overtimeHours * exceededPackage.pricePerHour;
        const alternativePrice = exceededPackagePrice + overtimePrice;

        return Math.min(hourPackagePrice, alternativePrice);
      }
    }

    return hourPackagePrice;
  };

  // Вынесенная функция для расчета основной цены
  const calculatePrice = (plan, relatedWorks, workingTime) => {
    const tariff = plan.type;
    const workingTimeHours = workingTime / 60;

    if (tariff === "hourPackage") {
      return calculateHourPackagePrice(plan, workingTimeHours);
    } else if (tariff === "hourly") {
      return (
        ((overallRoundedWorktime(relatedWorks, plan.tariffingPeriod) /
          (1000 * 60)) *
          plan.pricePerHour) /
        60
      );
    } else {
      return plan.fixedPrice;
    }
  };

  // Вынесенная функция для расчета дополнительной оплаты
  const calculateAdditionalPrice = (plan, relatedWorks, schedule) => {
    const tariff = plan.type;
    if (tariff === "hourly") {
      return 0;
    }

    return (
      (calculateOvertime(
        schedule,
        relatedWorks.filter(
          (work) => !work.ticketsCategories[0].alwaysWithinPlan,
        ),
        plan.tariffingPeriod,
      ).overtime *
        plan.pricePerHourNonWorking) /
      60
    );
  };

  // Функция для расчета итогов по месяцу
  const calculateMonthlyTotals = (monthData) => {
    let totalWorkingTime = 0;
    let totalPrice = 0;
    let totalAdditionalPrice = 0;

    monthData.forEach((data) => {
      const availableServicePlans = data.servicePlans.filter(
        (plan) => !confirmedReports.has(`${data.company._id}-${plan._id}`),
      );

      availableServicePlans.forEach((plan) => {
        const relatedWorks = data.works.filter((work) =>
          work.tickets
            .map((ticket) => ticket._id)
            .some((ticketId) =>
              data.tickets.find(
                (ticket) =>
                  ticket._id === ticketId &&
                  plan.ticketCategories
                    .map((category) => category._id.toString())
                    .includes(ticket.categoryId?.toString()),
              ),
            ),
        );

        if (relatedWorks.length > 0) {
          const schedule = plan.companyWorkSchedule
            ? data.company.workSchedule
            : plan.customProvisionSchedule;

          const workingTime = calculateWorkingTime(
            plan,
            relatedWorks,
            schedule,
          );
          const price = calculatePrice(plan, relatedWorks, workingTime);
          const additionalPrice = calculateAdditionalPrice(
            plan,
            relatedWorks,
            schedule,
          );

          totalWorkingTime += workingTime;
          totalPrice += price;
          totalAdditionalPrice += additionalPrice;
        }
      });
    });

    return {
      totalWorkingTime,
      totalPrice,
      totalAdditionalPrice,
      totalSum: totalPrice + totalAdditionalPrice,
    };
  };

  useEffect(() => {
    if (isRefreshing && preview) {
      setIsRefreshing(false);
    }
  }, [preview]);

  useEffect(() => {
    if (isRefreshing && revalidator.state === "idle") {
      setIsRefreshing(false);
    }
  }, [revalidator.state, isRefreshing]);

  return (
    <>
      {filterStore.statuses.includes("preview") && (
        <div className="mb-4">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h1 className="display-5 mb-0">Превью</h1>
            <Button
              size="lg"
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{ width: "200px" }}
            >
              {isRefreshing ? (
                <>
                  <Spinner
                    as="span"
                    animation="border"
                    size="sm"
                    role="status"
                    aria-hidden="true"
                    className="me-2"
                  />
                  Обновление...
                </>
              ) : (
                <>
                  <RiRefreshLine /> Обновить
                </>
              )}
            </Button>
          </div>

          {!preview.length ? (
            <Alert variant="secondary">Данные не найдены</Alert>
          ) : (
            <>
              {splitData.map((month) => {
                const monthlyTotals = calculateMonthlyTotals(month);

                return (
                  <div
                    key={getMonthName(month[0].works[0].finishedAt)}
                    className="card mb-4 shadow-sm"
                  >
                    <div className="card-header bg-light">
                      <h3 className="mb-0">
                        {getMonthName(month[0].works[0].finishedAt)}
                      </h3>
                    </div>
                    <div className="card-body p-0">
                      <Table responsive bordered className="mb-0">
                        <thead className="bg-light">
                          <tr>
                            <th>Услуга</th>
                            <th>Тариф</th>
                            <th>Часы</th>
                            <th className="text-end">Оплата в рамках тарифа</th>
                            <th className="text-end">Доп. оплата</th>
                            <th className="text-end">Итого</th>
                            <th>Действия</th>
                          </tr>
                        </thead>
                        {month.map((data) => {
                          const unrelatedWorks = filterUnrelatedWorks(
                            data.works,
                            data.tickets,
                            data.servicePlans,
                          );

                          const availableServicePlans =
                            data.servicePlans.filter(
                              (plan) =>
                                !confirmedReports.has(
                                  `${data.company._id}-${plan._id}`,
                                ),
                            );

                          // Check if any available service plans have related works
                          const hasVisibleReports = availableServicePlans.some(
                            (plan) => {
                              const relatedWorks = data.works.filter((work) =>
                                work.tickets
                                  .map((ticket) => ticket._id)
                                  .some((ticketId) =>
                                    data.tickets.find(
                                      (ticket) =>
                                        ticket._id === ticketId &&
                                        plan.ticketCategories
                                          .map((category) =>
                                            category._id.toString(),
                                          )
                                          .includes(
                                            ticket.categoryId?.toString(),
                                          ),
                                    ),
                                  ),
                              );
                              return relatedWorks.length > 0;
                            },
                          );

                          // Don't render company section if no visible reports
                          if (!hasVisibleReports) {
                            return null;
                          }

                          return (
                            <tbody
                              key={`${data.company._id.toString()}-${
                                month[0].works[0].finishedAt
                              }`}
                            >
                              <tr className="table-light">
                                <td colSpan={7} className="py-3">
                                  <div className="d-flex justify-content-between align-items-center">
                                    <strong>{data.company.fullTitle}</strong>
                                    <UnrelatedWorksOffcanvas
                                      unrelatedWorks={unrelatedWorks}
                                    />
                                  </div>
                                </td>
                              </tr>
                              {availableServicePlans.map((plan) => {
                                const relatedWorks = data.works.filter((work) =>
                                  work.tickets
                                    .map((ticket) => ticket._id)
                                    .some((ticketId) =>
                                      data.tickets.find(
                                        (ticket) =>
                                          ticket._id === ticketId &&
                                          plan.ticketCategories
                                            .map((category) =>
                                              category._id.toString(),
                                            )
                                            .includes(
                                              ticket.categoryId?.toString(),
                                            ),
                                      ),
                                    ),
                                );

                                if (relatedWorks.length === 0) {
                                  return null;
                                }

                                const schedule = plan.companyWorkSchedule
                                  ? data.company.workSchedule
                                  : plan.customProvisionSchedule;

                                const workingTime = calculateWorkingTime(
                                  plan,
                                  relatedWorks,
                                  schedule,
                                );
                                const price = calculatePrice(
                                  plan,
                                  relatedWorks,
                                  workingTime,
                                );
                                const additionalPrice =
                                  calculateAdditionalPrice(
                                    plan,
                                    relatedWorks,
                                    schedule,
                                  );
                                const sum = price + additionalPrice;

                                return (
                                  <tr
                                    key={`${plan._id.toString()}-${
                                      month[0].works[0].finishedAt
                                    }`}
                                    className="align-middle"
                                  >
                                    <td>{plan.title}</td>
                                    <td>
                                      {plan.type === "hourPackage" &&
                                        "Пакеты часов"}
                                      {plan.type === "hourly" &&
                                        "Почасовая оплата"}
                                      {plan.type === "fixedPrice" &&
                                        "Фиксированная оплата"}
                                    </td>
                                    <td>{msToHMS(workingTime * 1000 * 60)}</td>
                                    <td className="text-end">
                                      {formatPrice(price)}
                                    </td>
                                    <td className="text-end">
                                      {formatPrice(additionalPrice)}
                                    </td>
                                    <td className="text-end">
                                      {formatPrice(sum)}
                                    </td>
                                    <td>
                                      <TableActionBar
                                        plan={plan}
                                        data={data}
                                        amount={{
                                          price: price,
                                          additionalPrice: additionalPrice,
                                        }}
                                        relatedWorks={relatedWorks}
                                        unrelatedWorks={unrelatedWorks}
                                        onOptimisticConfirm={
                                          handleOptimisticConfirm
                                        }
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          );
                        })}
                        {/* Строка с итогами за месяц */}
                        <tfoot className="table-success">
                          <tr>
                            <td colSpan={2}>ИТОГО</td>
                            <td>
                              {msToHMS(
                                monthlyTotals.totalWorkingTime * 1000 * 60,
                              )}
                            </td>
                            <td className="text-end">
                              {formatPrice(monthlyTotals.totalPrice)}
                            </td>
                            <td className="text-end">
                              {formatPrice(monthlyTotals.totalAdditionalPrice)}
                            </td>
                            <td className="text-end">
                              {formatPrice(monthlyTotals.totalSum)}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </Table>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default PreviewTable;
