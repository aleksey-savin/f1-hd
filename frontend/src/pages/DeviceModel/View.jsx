import { useContext } from "react";
import { useLoaderData } from "react-router";

import ViewDeviceModel from "../../components/DeviceModel/View";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const ViewDeviceModelPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;
  const { deviceModel, configurations, attributes } = useLoaderData();

  if (!canUseInventoryModule || !canManageClientDevices) {
    return <Forbidden />;
  }

  return (
    <ViewDeviceModel
      deviceModel={deviceModel}
      configurations={configurations}
      attributes={attributes}
    />
  );
};

export default ViewDeviceModelPage;

export async function loader({ params }) {
  document.title = "Просмотр модели устройства";

  const { token } = getLocalStorageData();
  const headers = { Authorization: "Bearer " + token };
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const deviceModelResponse = await fetch(
    `${base}/device-models/${params.id}`,
    { headers },
  );

  if (!deviceModelResponse.ok) {
    throw deviceModelResponse;
  }

  const deviceModel = await deviceModelResponse.json();

  // Конфигурации модели.
  const configurationsResponse = await fetch(
    `${base}/device-configurations/model/${params.id}`,
    { headers },
  );
  const configurations = configurationsResponse.ok
    ? await configurationsResponse.json()
    : [];

  // Атрибуты типа устройства — каркас «спецификации» (порядок + единицы + опции).
  let attributes = [];
  const typeId = deviceModel.deviceTypeId?._id;
  if (typeId) {
    const typeResponse = await fetch(`${base}/device-types/${typeId}`, {
      headers,
    });
    if (typeResponse.ok) {
      const deviceType = await typeResponse.json();
      attributes = deviceType.attributes || [];
    }
  }

  return { deviceModel, configurations, attributes };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "delete") {
    const id = data.get("id");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/delete/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!response.ok) {
      throw response;
    }

    return { ok: true, deleted: true };
  }

  return { ok: true };
}
