import { useContext, useEffect, useState } from "react";
import { useLoaderData, useLocation } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";
import { scrollToSection } from "@/components/app/AnchorRail";
import { sectionAnchorId } from "@/components/app/FormLayout";
import { OverlayScrollContext } from "@/components/app/overlay-context";

import DeviceModelFormFields from "./FormFields";

const DeviceModelForm = ({
  title,
  presetDeviceTypeId,
  presetVendorId,
  successTo,
  successState,
}) => {
  const loaderData = useLoaderData();

  // При добавлении с карточки типа/вендора родитель известен заранее (params
  // вложенного маршрута) — подставляем в форму как минимальный deviceModel
  // (FormFields читает deviceModel?.deviceTypeId?._id / vendorId?._id).
  // Полные option'ы Select резолвит из loader-справочников.
  const deviceModel =
    loaderData?.deviceModel ||
    (presetDeviceTypeId || presetVendorId
      ? {
          ...(presetDeviceTypeId
            ? { deviceTypeId: { _id: presetDeviceTypeId } }
            : {}),
          ...(presetVendorId ? { vendorId: { _id: presetVendorId } } : {}),
        }
      : undefined);

  // Первая живая конфигурация (правка; список от сервера — свежие сверху)
  const configurations = loaderData?.configurations || [];
  const firstConfiguration =
    [...configurations].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    )[0] || null;

  // Режим — для пояснения у кнопок (только у полей характеристик)
  const [multiConfig, setMultiConfig] = useState(
    !!deviceModel?.multiConfig || configurations.length > 1,
  );

  // «Изменить» у характеристик на карточке ведёт сюда с #specs
  const location = useLocation();
  const scroller = useContext(OverlayScrollContext);
  useEffect(() => {
    if (location.hash !== "#specs") return undefined;
    // Без анимации: раздел должен быть на месте уже при открытии шторки
    const timer = setTimeout(
      () => scrollToSection(scroller, sectionAnchorId("specs"), false),
      0,
    );
    return () => clearTimeout(timer);
  }, [location.hash, scroller]);

  return (
    <FormWrapper
      title={title}
      successTo={successTo}
      successState={successState}
      actionsNote={multiConfig ? null : "Пустые поля можно заполнить позже."}
    >
      <DeviceModelFormFields
        deviceModel={deviceModel}
        configuration={firstConfiguration}
        configurationsCount={configurations.length}
        onChange={(state) => setMultiConfig(state.multiConfig)}
        deviceTypes={loaderData?.deviceTypes || []}
        vendors={loaderData?.vendors || []}
        deviceModels={loaderData?.deviceModels || []}
        lockDeviceType={Boolean(presetDeviceTypeId)}
      />
    </FormWrapper>
  );
};

export default DeviceModelForm;
