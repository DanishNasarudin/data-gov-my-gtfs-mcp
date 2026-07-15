import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { staticFeedUrl, type FeedKey } from "./feeds.js";

type Row = Record<string, string>;

interface StaticGtfs {
  loadedAt: number;
  stops: Row[];
  stopTimes: Row[];
  trips: Row[];
  routes: Row[];
  calendar: Row[];
  calendarDates: Row[];
}

export interface StationDeparture {
  stationName: string;
  stopId: string;
  platform?: string;
  arrivalTime: string;
  departureTime: string;
  routeId: string;
  routeShortName?: string;
  routeLongName?: string;
  tripId: string;
  destination?: string;
  directionId?: string;
  serviceId: string;
  serviceActive: boolean;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<FeedKey, StaticGtfs>();

function parseCsv(zip: AdmZip, filename: string, required = true): Row[] {
  const entry = zip.getEntry(filename);
  if (!entry) {
    if (!required) return [];
    throw new Error(`Static GTFS archive is missing ${filename}`);
  }
  return parse(entry.getData(), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true
  }) as Row[];
}

async function loadStaticGtfs(feed: FeedKey): Promise<StaticGtfs> {
  const existing = cache.get(feed);
  if (existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) return existing;

  const response = await fetch(staticFeedUrl(feed), {
    headers: { "user-agent": "data-gov-my-gtfs-mcp/1.2" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Static GTFS returned ${response.status} ${response.statusText}`);

  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const data: StaticGtfs = {
    loadedAt: Date.now(),
    stops: parseCsv(zip, "stops.txt"),
    stopTimes: parseCsv(zip, "stop_times.txt"),
    trips: parseCsv(zip, "trips.txt"),
    routes: parseCsv(zip, "routes.txt"),
    calendar: parseCsv(zip, "calendar.txt", false),
    calendarDates: parseCsv(zip, "calendar_dates.txt", false)
  };
  cache.set(feed, data);
  return data;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function dateParts(date: string): { compact: string; weekday: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must use YYYY-MM-DD");
  const parsed = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date");
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][parsed.getUTCDay()];
  return { compact: date.replaceAll("-", ""), weekday };
}

function activeServices(data: StaticGtfs, date: string): Set<string> {
  const { compact, weekday } = dateParts(date);
  const active = new Set<string>();
  for (const row of data.calendar) {
    if (row.start_date <= compact && compact <= row.end_date && row[weekday] === "1") active.add(row.service_id);
  }
  for (const row of data.calendarDates) {
    if (row.date !== compact) continue;
    if (row.exception_type === "1") active.add(row.service_id);
    if (row.exception_type === "2") active.delete(row.service_id);
  }
  return active;
}

function timeToSeconds(value: string): number {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function queryTimeToSeconds(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("aroundTime must use HH:mm or HH:mm:ss");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) throw new Error("aroundTime is invalid");
  return hours * 3600 + minutes * 60 + seconds;
}

export async function getStationDepartures(input: {
  feed: FeedKey;
  station: string;
  date: string;
  aroundTime: string;
  windowMinutes: number;
  limit: number;
  direction?: string;
}): Promise<{
  feed: FeedKey;
  date: string;
  queryTime: string;
  windowMinutes: number;
  matchedStations: Array<{ stopId: string; stopName: string }>;
  departures: StationDeparture[];
  excludedByServiceCalendar: StationDeparture[];
  diagnostics: {
    totalNearbyStopTimes: number;
    activeServiceCount: number;
    source: string;
    warning?: string;
  };
  staticFeedLoadedAt: string;
}> {
  const data = await loadStaticGtfs(input.feed);
  const stationQuery = normalize(input.station);
  if (!stationQuery) throw new Error("station is required");

  const exact = data.stops.filter((stop) => normalize(stop.stop_name) === stationQuery);
  const stationRows = exact.length > 0 ? exact : data.stops.filter((stop) => normalize(stop.stop_name).includes(stationQuery));
  if (stationRows.length === 0) throw new Error(`No station matched “${input.station}”`);

  const matchedIds = new Set(stationRows.map((stop) => stop.stop_id));
  for (const stop of data.stops) {
    if (stop.parent_station && matchedIds.has(stop.parent_station)) matchedIds.add(stop.stop_id);
  }

  const services = activeServices(data, input.date);
  const tripById = new Map(data.trips.map((trip) => [trip.trip_id, trip]));
  const routeById = new Map(data.routes.map((route) => [route.route_id, route]));
  const stopById = new Map(data.stops.map((stop) => [stop.stop_id, stop]));
  const center = queryTimeToSeconds(input.aroundTime);
  const windowSeconds = input.windowMinutes * 60;
  const directionQuery = input.direction ? normalize(input.direction) : undefined;

  const finalStopTimeByTrip = new Map<string, Row>();
  for (const stopTime of data.stopTimes) {
    const current = finalStopTimeByTrip.get(stopTime.trip_id);
    if (!current || Number(stopTime.stop_sequence) > Number(current.stop_sequence)) {
      finalStopTimeByTrip.set(stopTime.trip_id, stopTime);
    }
  }

  const nearby: StationDeparture[] = data.stopTimes.flatMap((stopTime): StationDeparture[] => {
    if (!matchedIds.has(stopTime.stop_id)) return [];
    const trip = tripById.get(stopTime.trip_id);
    if (!trip) return [];

    const finalStopTime = finalStopTimeByTrip.get(trip.trip_id);
    const inferredDestination = finalStopTime ? stopById.get(finalStopTime.stop_id)?.stop_name : undefined;
    const destination = trip.trip_headsign || inferredDestination;
    if (directionQuery && !normalize(destination ?? "").includes(directionQuery)) return [];

    const departureSeconds = timeToSeconds(stopTime.departure_time || stopTime.arrival_time);
    if (!Number.isFinite(departureSeconds) || Math.abs(departureSeconds - center) > windowSeconds) return [];

    const route = routeById.get(trip.route_id);
    const stop = stopById.get(stopTime.stop_id);
    return [{
      stationName: stop?.stop_name ?? stationRows[0].stop_name,
      stopId: stopTime.stop_id,
      platform: stop?.platform_code || undefined,
      arrivalTime: stopTime.arrival_time,
      departureTime: stopTime.departure_time,
      routeId: trip.route_id,
      routeShortName: route?.route_short_name || undefined,
      routeLongName: route?.route_long_name || undefined,
      tripId: trip.trip_id,
      destination: destination || undefined,
      directionId: trip.direction_id || undefined,
      serviceId: trip.service_id,
      serviceActive: services.has(trip.service_id)
    }];
  }).sort((a, b) => timeToSeconds(a.departureTime) - timeToSeconds(b.departureTime));

  const departures = nearby.filter((departure) => departure.serviceActive).slice(0, input.limit);
  const excludedByServiceCalendar = nearby.filter((departure) => !departure.serviceActive).slice(0, input.limit);
  const warning = departures.length === 0 && excludedByServiceCalendar.length === 0
    ? "No matching stop time exists in the current data.gov.my static GTFS archive. The KTMB app may use a newer or separate internal timetable."
    : undefined;

  return {
    feed: input.feed,
    date: input.date,
    queryTime: input.aroundTime,
    windowMinutes: input.windowMinutes,
    matchedStations: stationRows.slice(0, 10).map((stop) => ({ stopId: stop.stop_id, stopName: stop.stop_name })),
    departures,
    excludedByServiceCalendar,
    diagnostics: {
      totalNearbyStopTimes: nearby.length,
      activeServiceCount: services.size,
      source: staticFeedUrl(input.feed),
      warning
    },
    staticFeedLoadedAt: new Date(data.loadedAt).toISOString()
  };
}
