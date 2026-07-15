import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { staticFeedUrl } from "./feeds.js";
import { distanceKm, fetchVehicles, type VehiclePosition } from "./gtfs-realtime.js";

type StopRow = Record<string, string>;

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeTripId(value: string): string {
  const numeric = value.match(/(\d+)$/)?.[1];
  return numeric ?? value.toLowerCase();
}

async function getStationLocation(station: string): Promise<{
  stopName: string;
  latitude: number;
  longitude: number;
  matchedStopIds: string[];
}> {
  const response = await fetch(staticFeedUrl("ktmb"), {
    headers: { "user-agent": "data-gov-my-gtfs-mcp/1.3" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Static GTFS returned ${response.status} ${response.statusText}`);

  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const entry = zip.getEntry("stops.txt");
  if (!entry) throw new Error("Static GTFS archive is missing stops.txt");

  const stops = parse(entry.getData(), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true
  }) as StopRow[];

  const query = normalize(station);
  const exact = stops.filter((stop) => normalize(stop.stop_name) === query);
  const matches = exact.length > 0 ? exact : stops.filter((stop) => normalize(stop.stop_name).includes(query));
  if (matches.length === 0) throw new Error(`No station matched “${station}”`);

  const coordinateRows = matches.filter((stop) => Number.isFinite(Number(stop.stop_lat)) && Number.isFinite(Number(stop.stop_lon)));
  if (coordinateRows.length === 0) throw new Error(`Station “${station}” has no coordinates in static GTFS`);

  return {
    stopName: matches[0].stop_name,
    latitude: coordinateRows.reduce((sum, stop) => sum + Number(stop.stop_lat), 0) / coordinateRows.length,
    longitude: coordinateRows.reduce((sum, stop) => sum + Number(stop.stop_lon), 0) / coordinateRows.length,
    matchedStopIds: matches.map((stop) => stop.stop_id)
  };
}

function estimateVehicle(vehicle: VehiclePosition, station: { latitude: number; longitude: number }, assumedSpeedKph: number) {
  const distance = distanceKm(vehicle.latitude!, vehicle.longitude!, station.latitude, station.longitude);
  const liveSpeedKph = vehicle.speed != null ? vehicle.speed * 3.6 : undefined;
  const hasUsableLiveSpeed = liveSpeedKph != null && liveSpeedKph >= 10 && liveSpeedKph <= 140;
  const effectiveSpeedKph = hasUsableLiveSpeed ? liveSpeedKph : assumedSpeedKph;
  const travelMinutes = distance / effectiveSpeedKph * 60;
  const dwellAndSignalBufferMinutes = 2;
  const etaMinutes = Math.max(1, Math.round(travelMinutes + dwellAndSignalBufferMinutes));
  const baseTimeMs = (vehicle.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
  const estimatedArrival = new Date(baseTimeMs + etaMinutes * 60_000);

  return {
    tripId: vehicle.tripId,
    vehicleId: vehicle.vehicleId,
    vehicleLabel: vehicle.vehicleLabel,
    currentPosition: { latitude: vehicle.latitude, longitude: vehicle.longitude },
    distanceKmStraightLine: Number(distance.toFixed(2)),
    reportedSpeedKph: liveSpeedKph == null ? null : Number(liveSpeedKph.toFixed(1)),
    effectiveSpeedKph: Number(effectiveSpeedKph.toFixed(1)),
    estimatedMinutesToStation: etaMinutes,
    estimatedArrivalUtc: estimatedArrival.toISOString(),
    estimatedArrivalMalaysia: estimatedArrival.toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }),
    confidence: hasUsableLiveSpeed && distance <= 20 ? "medium" : "low",
    positionTimestamp: vehicle.timestamp ?? null
  };
}

export async function getLiveStationEstimate(input: {
  station: string;
  tripId?: string;
  assumedSpeedKph: number;
  maxCandidates: number;
}) {
  const [station, realtime] = await Promise.all([
    getStationLocation(input.station),
    fetchVehicles("ktmb")
  ]);

  const positioned = realtime.vehicles.filter((vehicle) => vehicle.latitude != null && vehicle.longitude != null);
  const requestedTrip = input.tripId ? normalizeTripId(input.tripId) : undefined;
  const matched = requestedTrip
    ? positioned.filter((vehicle) => vehicle.tripId && normalizeTripId(vehicle.tripId) === requestedTrip)
    : positioned;

  if (requestedTrip && matched.length === 0) {
    return {
      status: "trip_not_active",
      station,
      requestedTripId: input.tripId,
      fetchedAt: realtime.fetchedAt,
      activeTripIds: positioned.map((vehicle) => vehicle.tripId).filter(Boolean),
      warning: "The requested trip is not present in the current KTMB vehicle-position feed, so no ETA can be derived yet."
    };
  }

  const estimates = matched
    .map((vehicle) => estimateVehicle(vehicle, station, input.assumedSpeedKph))
    .sort((a, b) => a.estimatedMinutesToStation - b.estimatedMinutesToStation)
    .slice(0, input.maxCandidates);

  return {
    status: estimates.length > 0 ? "estimated" : "no_positioned_vehicles",
    station,
    requestedTripId: input.tripId ?? null,
    fetchedAt: realtime.fetchedAt,
    estimates,
    methodology: {
      type: "derived_estimate",
      distance: "straight-line distance from vehicle GPS point to station coordinates",
      speed: "reported GTFS speed when usable; otherwise assumedSpeedKph",
      fixedBufferMinutes: 2
    },
    warning: "This is not an official KTMB prediction. It does not yet account for rail geometry, direction of travel, intermediate stops, signals, or dwell time variability."
  };
}
