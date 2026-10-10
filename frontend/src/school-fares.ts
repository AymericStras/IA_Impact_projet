import type { Route } from "./api";

export const GROUP_FARE_SOURCE = "https://www.ter.sncf.com/occitanie/tarifs-cartes/voyage-groupes/scolaires";
export const GROUP_FARE_CHECKED = "10 octobre 2026";
export const GROUP_FARE_TIERS = [
  { min: 6, max: 10, price: 10 }, { min: 11, max: 20, price: 20 },
  { min: 21, max: 30, price: 30 }, { min: 31, max: 40, price: 40 },
  { min: 41, max: 50, price: 50 },
];

// Published group fare per liO train, not per pupil or per whole itinerary.
// Eligibility, dated trains and availability still require the SNCF quote.
export function groupFare(students: number, adults: number): number | null {
  if (![students, adults].every((n) => Number.isInteger(n) && n >= 1)) return null;
  const total = students + adults;
  return GROUP_FARE_TIERS.find((tier) => total >= tier.min && total <= tier.max)?.price ?? null;
}

export function estimateSchoolFare(students: number, adults: number, outbound: Pick<Route, "legs">, inbound: Pick<Route, "legs">) {
  const perTrain = groupFare(students, adults);
  if (perTrain === null) return null;
  const countTrains = (route: Pick<Route, "legs">) => {
    if (route.legs.some((leg) => leg.mode !== "Train TER" && leg.mode !== "Marche")) return null;
    return route.legs.filter((leg) => leg.mode === "Train TER").length || null;
  };
  const outboundTrains = countTrains(outbound), inboundTrains = countTrains(inbound);
  if (outboundTrains === null || inboundTrains === null) return null;
  return { perTrain, outboundTrains, inboundTrains, outbound: perTrain * outboundTrains,
    inbound: perTrain * inboundTrains, total: perTrain * (outboundTrains + inboundTrains) };
}
