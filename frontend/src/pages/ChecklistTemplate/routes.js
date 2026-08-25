// Loader и action справочника шаблонов чек-листов. Форма и создания, и правки
// нуждается в одних и тех же справочниках привязок, поэтому loader один.

const api = (path) => `${import.meta.env.VITE_API_ADDRESS}/api${path}`;

const authHeaders = () => {
  return {};
};

const fetchJson = async (path) => {
  const response = await fetch(api(path), { headers: authHeaders() });
  if (!response.ok) throw response;
  return response.json();
};

export async function checklistTemplateFormLoader({ params }) {
  const [formData, template] = await Promise.all([
    fetchJson("/checklist-templates/form-data"),
    params.id ? fetchJson(`/checklist-templates/${params.id}`) : null,
  ]);

  return { ...formData, template };
}

const post = async (path, payload) => {
  const response = await fetch(api(path), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if ([409, 422].includes(response.status)) {
    return response;
  }
  if (!response.ok) {
    throw response;
  }

  return response.json();
};

export async function addChecklistTemplateAction({ request }) {
  return post("/checklist-templates/add", await request.json());
}

export async function updateChecklistTemplateAction({ request, params }) {
  return post(`/checklist-templates/update/${params.id}`, await request.json());
}

export async function deleteChecklistTemplateAction({ request }) {
  const data = await request.formData();
  const response = await fetch(
    api(`/checklist-templates/delete/${data.get("id")}`),
    { method: "POST", headers: authHeaders() },
  );

  if (!response.ok) throw response;
  return { ok: true };
}
