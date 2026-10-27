/** The device's real brand + model, as the owner entered them. Single source for every page title. */
export const deviceLabel = (d: { brand: string; model: string }) => `${d.brand} ${d.model}`.replace(/\s+/g, " ").trim();
