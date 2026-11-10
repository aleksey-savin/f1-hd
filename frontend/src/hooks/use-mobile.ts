import { useEffect, useState } from "react";

// Порог оболочки совпадает с lg и правым рейлом присутствия.
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(query.matches);
    query.addEventListener("change", onChange);
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
