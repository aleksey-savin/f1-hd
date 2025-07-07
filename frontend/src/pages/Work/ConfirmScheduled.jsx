import FormConfirmScheduled from "../../components/Work/FormConfirmScheduled";
import { getLocalStorageData } from "../../util/auth";

const ConfirmScheduledWorkPage = () => {
  return <FormConfirmScheduled title="Подтвердить выполнение работ" />;
};

export default ConfirmScheduledWorkPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/works/additional-data/${params.ticketNum}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}
