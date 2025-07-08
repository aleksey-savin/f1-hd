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
              {splitData.map((month) => (
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
                          <th className="text-end">Оплата рамках тарифа</th>
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

                        const availableServicePlans = data.servicePlans.filter(
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

                              const schedule = plan.companyWorkSchedule
                                ? data.company.workSchedule
                                : plan.customProvisionSchedule;

                              const tariff = plan.type;

                              const workingTime =
                                tariff === "hourly"
                                  ? overallRoundedWorktime(
                                      relatedWorks,
                                      plan.tariffingPeriod,
                                    ) /
                                    (1000 * 60)
                                  : calculateWorkTime(
                                      schedule,
                                      relatedWorks,
                                      plan.tariffingPeriod,
                                    ).roundedWorktime;

                              const hourPackagePrice = (
                                schedule,
                                relatedWorks,
                                plan,
                              ) => {
                                const workingTimeHours = workingTime / 60;
                                let hourPackageHours = 0;
                                let hourPackagePrice = 0;

                                for (let hourPackage of plan.hourPackages) {
                                  if (workingTimeHours <= hourPackage.hours) {
                                    hourPackageHours = hourPackage.hours;
                                    hourPackagePrice =
                                      hourPackageHours *
                                      hourPackage.pricePerHour;
                                    break;
                                  }
                                }

                                if (
                                  hourPackageHours === 0 &&
                                  plan.hourPackages.length > 0
                                ) {
                                  const lastPackage =
                                    plan.hourPackages[
                                      plan.hourPackages.length - 1
                                    ];
                                  hourPackageHours =
                                    lastPackage.hours +
                                    (workingTimeHours - lastPackage.hours);
                                  hourPackagePrice =
                                    hourPackageHours * lastPackage.pricePerHour;
                                }

                                return hourPackagePrice;
                              };

                              const hourlyPrice =
                                ((overallRoundedWorktime(
                                  relatedWorks,
                                  plan.tariffingPeriod,
                                ) /
                                  (1000 * 60)) *
                                  plan.pricePerHour) /
                                60;

                              const fixedPrice = plan.fixedPrice;

                              const price =
                                tariff === "hourPackage"
                                  ? hourPackagePrice(
                                      schedule,
                                      relatedWorks,
                                      plan,
                                    )
                                  : tariff === "hourly"
                                    ? hourlyPrice
                                    : fixedPrice;

                              const additionalPrice =
                                tariff === "hourly"
                                  ? 0
                                  : (calculateOvertime(
                                      schedule,
                                      relatedWorks.filter(
                                        (work) =>
                                          !work.ticketsCategories[0]
                                            .alwaysWithinPlan,
                                      ),
                                      plan.tariffingPeriod,
                                    ).overtime *
                                      plan.pricePerHourNonWorking) /
                                    60;

                              const sum = price + additionalPrice;

                              return (
                                relatedWorks.length > 0 && (
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
                                )
                              );
                            })}
                          </tbody>
                        );
                      })}
                    </Table>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default PreviewTable;
