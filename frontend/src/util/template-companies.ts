/**
 * Компании шаблона заявки — для фасета «Компания» на главной и в списке
 * шаблонов.
 *
 * У шаблона их два источника: `company` — на кого он заводит заявку, и
 * `sharedCompanies` — кому из клиентов он роздан. Фасет прежде читал только
 * второй, а шаблоны сотрудников под конкретного клиента почти всегда не
 * розданы никому: у Автогаранта оба шаблона такие, и компании не было даже в
 * списке вариантов.
 */
type CompanyRef = { _id?: unknown; alias?: string };

type TemplateLike = {
  company?: CompanyRef | null;
  sharedCompanies?: CompanyRef[] | null;
};

export const templateCompanies = (template: TemplateLike): CompanyRef[] => {
  const seen = new Set<string>();
  const out: CompanyRef[] = [];
  for (const company of [
    template.company,
    ...(template.sharedCompanies ?? []),
  ]) {
    const id = company?._id ? String(company._id) : "";
    if (company && id && !seen.has(id)) {
      seen.add(id);
      out.push(company);
    }
  }
  return out;
};

export const templateHasCompany = (
  template: TemplateLike,
  companyIds: string[],
): boolean =>
  templateCompanies(template).some((company) =>
    companyIds.includes(String(company._id)),
  );
