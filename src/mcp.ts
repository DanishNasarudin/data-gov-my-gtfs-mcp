import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FEEDS, type FeedKey } from "./feeds.js";
import { distanceKm, fetchVehicles } from "./gtfs-realtime.js";
import { getStationDepartures } from "./gtfs-static.js";
const feedKeys=Object.keys(FEEDS) as FeedKey[]; const feedSchema=z.enum(feedKeys as [FeedKey,...FeedKey[]]);
const text=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value,null,2)}]});
export function createMcpServer():McpServer{
 const server=new McpServer({name:"data-gov-my-gtfs",version:"1.1.0"});
 server.registerTool("list_feeds",{title:"List Malaysian GTFS feeds",description:"List supported Malaysian public-transport feeds."},async()=>text(Object.entries(FEEDS).map(([id,v])=>({id,label:v.label}))));
 server.registerTool("get_vehicle_positions",{title:"Get vehicle positions",description:"Fetch current vehicle positions from a Malaysian GTFS-Realtime feed.",inputSchema:{feed:feedSchema,routeId:z.string().optional(),limit:z.number().int().min(1).max(500).default(100)}},async({feed,routeId,limit})=>{const r=await fetchVehicles(feed);const vehicles=r.vehicles.filter(v=>!routeId||v.routeId===routeId).slice(0,limit);return text({...r,totalMatched:vehicles.length,vehicles});});
 server.registerTool("find_vehicles_near",{title:"Find nearby vehicles",description:"Find live vehicles within a radius of a coordinate.",inputSchema:{feed:feedSchema,latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),radiusKm:z.number().positive().max(100).default(2),limit:z.number().int().min(1).max(200).default(50)}},async({feed,latitude,longitude,radiusKm,limit})=>{const r=await fetchVehicles(feed);const vehicles=r.vehicles.filter(v=>v.latitude!=null&&v.longitude!=null).map(v=>({...v,distanceKm:distanceKm(latitude,longitude,v.latitude!,v.longitude!)})).filter(v=>v.distanceKm<=radiusKm).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,limit);return text({fetchedAt:r.fetchedAt,radiusKm,totalMatched:vehicles.length,vehicles});});
 server.registerTool("get_station_departures",{title:"Get scheduled station departures",description:"Get scheduled departures around a local Malaysia time from a station using the static GTFS timetable. Use YYYY-MM-DD and HH:MM in Asia/Kuala_Lumpur time.",inputSchema:{feed:feedSchema.default("ktmb"),station:z.string().min(2),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),aroundTime:z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),windowMinutes:z.number().int().min(1).max(180).default(60),limit:z.number().int().min(1).max(100).default(30)}},async(args)=>text(await getStationDepartures(args)));
 return server;
}
