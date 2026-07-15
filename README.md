# Malaysia GTFS MCP

A stateless TypeScript MCP server for Malaysia's official `data.gov.my` GTFS feeds.

## Production endpoints

- MCP: `https://data-gov-my-gtfs-mcp.vercel.app/mcp`
- Health: `https://data-gov-my-gtfs-mcp.vercel.app/health`

## Tools

- `list_feeds`
- `get_vehicle_positions`
- `find_vehicles_near`
- `get_station_departures` — scheduled KTMB arrivals/departures from static GTFS

## Development

```bash
npm install
npm run build
```

The realtime feed provides vehicle positions. Scheduled station departures are resolved from the daily static GTFS archive using service calendars and calendar exceptions.
