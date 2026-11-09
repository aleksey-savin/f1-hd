// Menu visibility and the route guard must use the same requirement.
export const TAXI_REPORT_ACCESS = {
  taxi: {
    actions: ["read", "allocate", "configure"],
    connector: "OR",
  },
};
