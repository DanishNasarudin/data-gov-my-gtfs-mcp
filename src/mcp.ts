import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FEEDS, type FeedKey } from "./feeds.js";
import { distanceKm, fetchVehicles } from "./gtfs-realtime.js";
import { getStationDepartures } from "./gtfs-static.js";
import { getLiveStationEstimate } from "./live-estimate.js";

const feedKeys = Object.keys(FEEDS) as FeedKey[];
const feedSchema = z.enum(feedKeys as [FeedKey, ...FeedKey[]]);
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "data-gov-my-gtfs", version: "1.3.0" });

  server.registerTool("list_feeds", {
    title: "List Malaysian GTFS feeds",
    description: "List supported public-transport feeds from Malaysia's official data.gov.my API."
  }, async () => text(Object.entries(FEEDS).map(([id, value]) => ({ id, label: value.label }))));

  server.registerTool("get_vehicle_positions", {
    title: "Get vehicle positions",
    description: "Fetch current vehicle positions from one Malaysian GTFS-Realtime feed.",
    inputSchema: {
      feed: feedSchema,
      routeId: z.string().optional().describe("Optional exact GTFS route_id filter"),
      limit: z.number().int().min(1).max(500).default(100)
    }
  }, async ({ feed, routeId, limit }) => {
    const result = await fetchVehicles(feed);
    const vehicles = result.vehicles.filter((vehicle) => !routeId || vehicle.routeId === routeId).slice(0, limit);
    return text({ ...result, totalMatched: vehicles.length, vehicles });
  });

  server.registerTool("find_vehicles_near", {
    title: "Find nearby vehicles",
    description: "Find live public-transport vehicles within a radius of a latitude/longitude point.",
    inputSchema: {
      feed: feedSchema,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusKm: z.number().positive().max(100).default(2),
      limit: z.number().int().min(1).max(200).default(50)
    }
  }, async ({ feed, latitude, longitude, radiusKm, limit }) => {
    const result = await fetchVehicles(feed);
    const vehicles = result.vehicles
      .filter((vehicle) => vehicle.latitude != null && vehicle.longitude != null)
      .map((vehicle) => ({
        ...vehicle,
        distanceKm: distanceKm(latitude, longitude, vehicle.latitude!, vehicle.longitude!)
      }))
      .filter((vehicle) => vehicle.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
    return text({ fetchedAt: result.fetchedAt, radiusKm, totalMatched: vehicles.length, vehicles });
  });

  server.registerTool("get_station_departures", {
    title: "Get scheduled station departures",
    description: "Get scheduled train arrivals and departures near a requested time using the official static GTFS timetable. Currently supports KTMB.",
    inputSchema: {
      feed: z.literal("ktmb").default("ktmb"),
      station: z.string().min(1).describe("Station name, for example Mid Valley"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Service date in YYYY-MM-DD, Malaysia time"),
      aroundTime: z.string().regex(/^\d{1,2}:\d{2}(?::\d{2})?$/).describe("Time in HH:mm or HH:mm:ss, Malaysia time"),
      windowMinutes: z.number().int().min(1).max(360).default(60),
      direction: z.string().optional().describe("Optional destination/headsign text filter"),
      limit: z.number().int().min(1).max(100).default(30)
    }
  }, async (input) => text(await getStationDepartures(input)));

  server.registerTool("get_live_station_estimate", {
    title: "Estimate a live KTMB station arrival",
    description: "Derive a non-official ETA to a KTMB station from the current vehicle-position feed. Results are approximate and include confidence and methodology warnings.",
    inputSchema: {
      station: z.string().min(1).describe("Target KTMB station name, for example Midvalley"),
      tripId: z.string().optional().describe("Optional trip ID, for example 2047 or weekday_2047"),
      assumedSpeedKph: z.number().min(10).max(120).default(45).describe("Fallback average speed when realtime speed is missing or unusable"),
      maxCandidates: z.number().int().min(1).max(20).default(5)
    }
  }, async (input) => text(await getLiveStationEstimate(input)));

  return server;
}
