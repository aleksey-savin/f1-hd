import { useState, useEffect } from "react";

import { getLocalStorageData } from "../../util/auth";

const refId = (v) => v?._id || v || "";

// Подпись пользователя в выпадающем списке: ФИО (или email), с пометкой для
// руководителя подразделения.
export const userOptionLabel = (u) => {
  const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
  return u.isSubdivisionManager ? `${name} — Руководитель подразделения` : name;
};

// Кандидаты на привязку устройства к пользователю по правилам расположения
// (логика на бэкенде: GET /api/inventory/locations/:id/assignable-users):
//  • рабочее место с сотрудником → только он (single, по умолчанию);
//  • есть подразделение → его сотрудники, руководитель по умолчанию и с пометкой;
//  • иначе → все пользователи компании.
// Без расположения откатываемся на всех активных пользователей компании.
export default function useAssignableUsers(locationId, companyId) {
  const [users, setUsers] = useState([]);
  const [defaultUserId, setDefaultUserId] = useState(null);
  const [single, setSingle] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { token } = getLocalStorageData();
    const headers = { Authorization: "Bearer " + token };
    const base = import.meta.env.VITE_API_ADDRESS;
    let cancelled = false;

    const reset = () => {
      setUsers([]);
      setDefaultUserId(null);
      setSingle(false);
    };

    const load = async () => {
      setLoading(true);
      try {
        if (locationId) {
          const res = await fetch(
            `${base}/api/inventory/locations/${locationId}/assignable-users`,
            { headers },
          );
          const data = await res.json();
          if (cancelled) return;
          setUsers(Array.isArray(data.users) ? data.users : []);
          setDefaultUserId(data.defaultUserId || null);
          setSingle(!!data.single);
        } else if (companyId) {
          // Нет расположения — все активные пользователи компании.
          const res = await fetch(`${base}/api/users?activeOnly=true`, {
            headers,
          });
          const data = await res.json();
          if (cancelled) return;
          const list = (Array.isArray(data) ? data : data.users || []).filter(
            (u) => refId(u.company) === companyId,
          );
          setUsers(
            list.map((u) => ({
              _id: u._id,
              firstName: u.firstName,
              lastName: u.lastName,
              email: u.email,
              isSubdivisionManager: false,
            })),
          );
          setDefaultUserId(null);
          setSingle(false);
        } else {
          reset();
        }
      } catch (error) {
        if (!cancelled) reset();
        console.error("Error fetching assignable users:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [locationId, companyId]);

  return { users, defaultUserId, single, loading };
}
