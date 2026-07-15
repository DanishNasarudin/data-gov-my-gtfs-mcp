import type { VercelRequest,VercelResponse } from "@vercel/node";
export default function handler(_req:VercelRequest,res:VercelResponse){res.status(200).json({status:"ok",service:"data-gov-my-gtfs-mcp",version:"1.1.0",mcpEndpoint:"/mcp",tools:["list_feeds","get_vehicle_positions","find_vehicles_near","get_station_departures"]});}
