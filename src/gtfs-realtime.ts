import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { FEEDS, realtimeFeedUrl, type FeedKey } from "./feeds.js";
export interface VehiclePosition { entityId:string; vehicleId?:string; vehicleLabel?:string; tripId?:string; routeId?:string; latitude?:number; longitude?:number; bearing?:number; speed?:number; timestamp?:number; feed:FeedKey; feedLabel:string }
export async function fetchVehicles(feed: FeedKey): Promise<{vehicles:VehiclePosition[]; fetchedAt:string}> {
  const response = await fetch(realtimeFeedUrl(feed), {headers:{"user-agent":"data-gov-my-gtfs-mcp/1.1"}, signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`data.gov.my returned ${response.status} ${response.statusText}`);
  const decoded = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
  const vehicles = decoded.entity.flatMap(entity => {
    const v = entity.vehicle; if (!v) return [];
    return [{entityId:entity.id, vehicleId:v.vehicle?.id ?? undefined, vehicleLabel:v.vehicle?.label ?? undefined, tripId:v.trip?.tripId ?? undefined, routeId:v.trip?.routeId ?? undefined, latitude:v.position?.latitude ?? undefined, longitude:v.position?.longitude ?? undefined, bearing:v.position?.bearing ?? undefined, speed:v.position?.speed ?? undefined, timestamp:v.timestamp == null ? undefined : Number(v.timestamp), feed, feedLabel:FEEDS[feed].label}];
  });
  return {vehicles, fetchedAt:new Date().toISOString()};
}
export function distanceKm(aLat:number,aLon:number,bLat:number,bLon:number):number { const R=6371; const r=(d:number)=>d*Math.PI/180; const dLat=r(bLat-aLat), dLon=r(bLon-aLon); const x=Math.sin(dLat/2)**2+Math.cos(r(aLat))*Math.cos(r(bLat))*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
