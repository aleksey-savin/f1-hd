import { useEffect, useState } from "react";
import { useActionData, useFetcher } from "react-router";

import { FaAngleLeft, FaAngleRight } from "react-icons/fa";

import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import { getLocalStorageData } from "../../util/auth";

import { calcSingleWorkOvertime } from "../../util/finances";

const PersonalReport = () => {
  const fetcher = useFetcher();
  const [date, setDate] = useState(new Date());

  const data = useActionData() ?? fetcher.data;

  useEffect(() => {
    if (data) {
      let overtimeWorksData = [];

      let withinTariffWorksData = [];

      for (let work of data.works) {
        if (work.servicePlan) {
          const schedule = work.servicePlan?.companyWorkSchedule
            ? work.company?.workSchedule
            : work.servicePlan?.customProvisionSchedule;
          const overtime = calcSingleWorkOvertime(
            schedule,
            work.startedAt,
            work.finishedAt,
          );

          if (overtime) {
            overtimeWorksData.push({ ...work, overtime: overtime });
          } else {
            withinTariffWorksData.push(work);
          }
        }
      }
    }
  }, [data]);

  const handlePrevMonth = () => {
    setDate(new Date(date.setMonth(date.getMonth() - 1)));
    fetcher.submit({ date: date }, { method: "post", action: "." });
  };

  const handleNextMonth = () => {
    setDate(new Date(date.setMonth(date.getMonth() + 1)));
    fetcher.submit({ date: date }, { method: "post", action: "." });
  };

  return (
    <>
      <fetcher.Form>
        <Row>
          <Col>
            <Button size="lg" onClick={handlePrevMonth}>
              <FaAngleLeft />
            </Button>
            <span className="px-3">
              {`${date.toLocaleDateString("ru-Ru", { month: "long" }).toUpperCase()} ${date.toLocaleDateString("ru-Ru", { year: "numeric" })}`}
            </span>
            <input
              hidden
              name="date"
              value={date}
              onChange={() => {
                return;
              }}
            />
            <Button size="lg" onClick={handleNextMonth}>
              <FaAngleRight />
            </Button>
          </Col>
        </Row>
        <Row></Row>
      </fetcher.Form>
    </>
  );
};

export default PersonalReport;

export async function loader() {
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const date = data.get("date");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/personal-report/${date}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  const responseData = await response.json();

  return responseData;
}
