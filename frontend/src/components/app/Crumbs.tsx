import { usePageCrumbs } from "./crumb-context";
import type { CrumbLink } from "@/util/crumb-trail";

export { useCrumbFrom } from "./crumb-context";
export type { CrumbLink, CrumbOrigin } from "@/util/crumb-trail";

/** Register the page's label and hierarchy in the shared app header. */
export default function Crumbs({
  title,
  section,
  chain,
}: {
  title?: string;
  section?: string | false;
  chain?: CrumbLink[];
}) {
  usePageCrumbs({ title, section, chain });
  return null;
}
