import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { staticFeedUrl, type FeedKey } from "./feeds.js";

type Row = Record<string,string>;
type FeedData = {stops:Row[]; stopTimes:Row[]; trips:Row[]; routes:Row[]; calendar:Row[]; calendarDates:Row[]; fetchedAt:string};
const cache = new Map<FeedKey,{expires:number; data:FeedData}>();
const readCsv = (zip:AdmZip,name:string):Row[] => { const entry=zip.getEntry(name); return entry ? parse(entry.getData().toString("utf8"),{columns:true,skip_empty_lines:true,bom:true,relax_column_count:true,trim:true}) : []; };
export async function fetchStaticFeed(feed:FeedKey):Promise<FeedData>{
  const hit=cache.get(feed); if(hit && hit.expires>Date.now()) return hit.data;
  const response=await fetch(staticFeedUrl(feed),{headers:{"user-agent":"data-gov-my-gtfs-mcp/1.1"},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Static GTFS returned ${response.status} ${response.statusText}`);
  const zip=new AdmZip(Buffer.from(await response.arrayBuffer()));
  const data={stops:readCsv(zip,"stops.txt"),stopTimes:readCsv(zip,"stop_times.txt"),trips:readCsv(zip,"trips.txt"),routes:readCsv(zip,"routes.txt"),calendar:readCsv(zip,"calendar.txt"),calendarDates:readCsv(zip,"calendar_dates.txt"),fetchedAt:new Date().toISOString()};
  cache.set(feed,{expires:Date.now()+6*60*60*1000,data}); return data;
}
const compactDate=(date:string)=>date.replaceAll("-","");
function activeServices(data:FeedData,date:string):Set<string>{
  const target=compactDate(date); const d=new Date(`${date}T12:00:00+08:00`); const weekday=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][d.getDay()];
  const active=new Set<string>();
  for(const row of data.calendar){ if(row.start_date<=target && row.end_date>=target && row[weekday]==="1") active.add(row.service_id); }
  for(const row of data.calendarDates){ if(row.date!==target) continue; if(row.exception_type==="1") active.add(row.service_id); if(row.exception_type==="2") active.delete(row.service_id); }
  return active;
}
function seconds(hhmmss:string):number { const [h,m,s]=hhmmss.split(":").map(Number); return h*3600+m*60+(s||0); }
export async function getStationDepartures(args:{feed:FeedKey; station:string; date:string; aroundTime:string; windowMinutes:number; limit:number}){
  const data=await fetchStaticFeed(args.feed); const needle=args.station.toLowerCase().trim();
  const matchedStops=data.stops.filter(s => (s.stop_name||"").toLowerCase().includes(needle));
  if(!matchedStops.length) return {feed:args.feed,stationQuery:args.station,date:args.date,aroundTime:args.aroundTime,matchedStops:[],departures:[],note:"No matching station found"};
  const stopIds=new Set(matchedStops.map(s=>s.stop_id)); const services=activeServices(data,args.date); const tripById=new Map(data.trips.map(t=>[t.trip_id,t])); const routeById=new Map(data.routes.map(r=>[r.route_id,r]));
  const center=seconds(args.aroundTime.length===5?`${args.aroundTime}:00`:args.aroundTime); const half=args.windowMinutes*60;
  const departures=data.stopTimes.filter(st=>stopIds.has(st.stop_id) && st.departure_time && Math.abs(seconds(st.departure_time)-center)<=half).flatMap(st=>{
    const trip=tripById.get(st.trip_id); if(!trip || (services.size>0 && !services.has(trip.service_id))) return [];
    const route=routeById.get(trip.route_id);
    const stop=matchedStops.find(s=>s.stop_id===st.stop_id)!;
    return [{station:stop.stop_name,stopId:st.stop_id,departureTime:st.departure_time,arrivalTime:st.arrival_time,tripId:st.trip_id,headsign:trip.trip_headsign||undefined,directionId:trip.direction_id||undefined,routeId:trip.route_id,routeShortName:route?.route_short_name||undefined,routeLongName:route?.route_long_name||undefined,serviceId:trip.service_id,stopSequence:Number(st.stop_sequence)}];
  }).sort((a,b)=>seconds(a.departureTime)-seconds(b.departureTime)).slice(0,args.limit);
  return {feed:args.feed,stationQuery:args.station,date:args.date,aroundTime:args.aroundTime,windowMinutes:args.windowMinutes,matchedStops:matchedStops.map(s=>({stopId:s.stop_id,stopName:s.stop_name,latitude:Number(s.stop_lat),longitude:Number(s.stop_lon)})),fetchedAt:data.fetchedAt,totalMatched:departures.length,departures};
}
