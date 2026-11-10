import { NavLink } from "react-router";

import BrandMark from "@/components/app/BrandMark";
import useInitialPrefs from "@/store/prefs";

export default function Brand({ size = "default" }) {
  const { contacts, brand } = useInitialPrefs();

  return (
    <NavLink
      to="/dashboard"
      aria-label={`${brand.productName} — на главную`}
      className="inline-flex min-w-0 max-w-full items-center no-underline"
    >
      <BrandMark
        logo={contacts?.logo}
        name={brand.productName}
        icon={brand.icon}
        size={size}
        className="max-w-full object-contain"
      />
    </NavLink>
  );
}
