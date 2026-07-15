export const FEEDS = {
  ktmb: { agency: "ktmb", label: "KTMB" },
  "rapid-bus-kl": { agency: "prasarana", category: "rapid-bus-kl", label: "Rapid Bus KL" },
  "rapid-bus-mrtfeeder": { agency: "prasarana", category: "rapid-bus-mrtfeeder", label: "MRT Feeder Bus" },
  "rapid-bus-kuantan": { agency: "prasarana", category: "rapid-bus-kuantan", label: "Rapid Kuantan" },
  "rapid-bus-penang": { agency: "prasarana", category: "rapid-bus-penang", label: "Rapid Penang" },
  "mybas-kangar": { agency: "mybas-kangar", label: "BAS.MY Kangar" },
  "mybas-alor-setar": { agency: "mybas-alor-setar", label: "BAS.MY Alor Setar" },
  "mybas-kota-bharu": { agency: "mybas-kota-bharu", label: "BAS.MY Kota Bharu" },
  "mybas-kuala-terengganu": { agency: "mybas-kuala-terengganu", label: "BAS.MY Kuala Terengganu" },
  "mybas-ipoh": { agency: "mybas-ipoh", label: "BAS.MY Ipoh" },
  "mybas-seremban-a": { agency: "mybas-seremban-a", label: "BAS.MY Seremban A" },
  "mybas-seremban-b": { agency: "mybas-seremban-b", label: "BAS.MY Seremban B" },
  "mybas-melaka": { agency: "mybas-melaka", label: "BAS.MY Melaka" },
  "mybas-johor": { agency: "mybas-johor", label: "BAS.MY Johor Bahru" },
  "mybas-kuching": { agency: "mybas-kuching", label: "BAS.MY Kuching" }
} as const;
export type FeedKey = keyof typeof FEEDS;
export function realtimeFeedUrl(feed: FeedKey): string {
  const config = FEEDS[feed];
  const url = new URL(`https://api.data.gov.my/gtfs-realtime/vehicle-position/${config.agency}`);
  if ("category" in config) url.searchParams.set("category", config.category);
  return url.toString();
}
export function staticFeedUrl(feed: FeedKey): string {
  const config = FEEDS[feed];
  const url = new URL(`https://api.data.gov.my/gtfs-static/${config.agency}`);
  if ("category" in config) url.searchParams.set("category", config.category);
  return url.toString();
}
