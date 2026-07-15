import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FEEDS, type FeedKey } from "./feeds.js";
import { distanceKm, fetchVehicles } from "./gtfs-realtime.js";
import { getStationDepartures } from "./gtfs-static.js";

const feedKeys = Object.keys(FEEDS) as FeedKey[];
const feedSchema = z.enum(feedKeys as [FeedKey, ...FeedKey[]]);
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "data-gov-my-gtfs", version: "1.1.0" });

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

  return server;
}
