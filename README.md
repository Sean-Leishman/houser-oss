# Houser

Find a rental by how far it is from where you go every day. Houser shows homes on a map with transit lines, stops, parks, supermarkets, gyms and other everyday places, and routes walking, cycling and driving times to your daily place.

Houser comes without listings. You add your own: see [docs/sources.md](docs/sources.md).

Website: [houser-sigma.vercel.app](https://houser-sigma.vercel.app)

## Run locally

```bash
npm install
npm run dev
```

Put a listings file in `data/`, or write a connector and run `npm run homes:fetch` ([docs/sources.md](docs/sources.md)). Then open the URL Vite prints.

`npm run build && npm start` serves the production build and API on port 4173. `npm test` runs the server tests. Node.js 20.19+ or 22.12+. No API keys needed.

## Features

- City search, limited to the countries you have homes for. The map opens on the city centre and stays inside the loaded area, about 22 km across.
- A daily place, searched or picked on the map, with walk, bike, quiet bike, transit or car and a 15 to 60 minute limit. For every mode but transit, areas beyond the limit are faded. Quiet keeps to minor roads and cycleways where it can; a bike trip shows both routes with their share on main roads.
- Home cards with rent, details, trip time, nearest lines and stops, and nearest supermarket and gym.
- Filters for rent, rooms, type, homes near a line, and homes within a 10-minute walk of a chosen supermarket or gym chain.
- Map layers for rail, metro, tram and bus lines, shops, food, sports, health, schools, parks, and supermarket and gym chains.
- Saved homes with a status and notes, kept in the browser.

## Data

| Data | Source |
| --- | --- |
| Homes | Files in `data/` |
| Base map | [OpenFreeMap](https://openfreemap.org) |
| Lines, stops, places, parks | OpenStreetMap via [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API), cached 7 days |
| Walk, bike and car times, reach areas, routes | [Valhalla](https://github.com/valhalla/valhalla) on the FOSSGIS demo server, cached 7 days |
| Transit times | Estimated from distance, shown with "≈" |

Walk, bike and car times are routed for the 500 homes nearest the daily place and estimated for the rest.

The public Overpass and Valhalla servers are for light use. For a public deployment, set `OVERPASS_URL` and `VALHALLA_URL` to your own instances (see `.env.example`).

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/listings?city=&lon=&lat=` | Homes in the city's loaded area, with a count per source |
| `GET /api/sources` | Each file in `data/` with its homes, skipped entries and countries |
| `GET /api/transit?part=rail\|bus\|chains\|pois\|parks&lon=&lat=` | Rail or bus lines with stops, supermarkets and gyms, other places, or parks for an area |
| `POST /api/commute` `{ mode, to, from: [[lon, lat], …] }` | Travel seconds and kilometres from up to 500 origins to one destination (walk, bike, quiet, car) |
| `GET /api/reach?mode=&lon=&lat=` | Areas reachable in 15, 30, 45 and 60 minutes |
| `GET /api/route?mode=&from=lon,lat&to=lon,lat` | Duration, distance and route geometry, with metres of climb and descent for walk and bike, and the share on main roads for bike and quiet |

Caches live in `.cache/`.

## Layout

```text
src/
  App.tsx            State, data loading, side panel
  MapView.tsx        Map layers and interaction
  ListingCard.tsx    Home card
  ListingDetail.tsx  Selected home
  LayerLegend.tsx    Layer switcher and chain picker
  PlaceSearch.tsx    Place search
  access.ts          Nearest lines, stops and chains per home
  network.ts         Merges rail and bus lines
  api.ts, storage.ts, geo.ts, format.ts, layers.ts, types.ts, LineBadge.tsx, Popover.tsx
server/
  api.mjs            HTTP routes
  listings.mjs       Reads and checks the files in data/
  fetch-homes.mjs    npm run homes:fetch
  sources/           Connectors
  transit.mjs        OpenStreetMap lines, stops, places and parks
  routing.mjs        Valhalla trip times, reach areas and routes
  cache.mjs          Request sharing and disk cache
  index.mjs          Production server
```

## Contributing

Pull requests are welcome. Run `npm test` and `npm run build` before opening one.

## License

[AGPL-3.0-or-later](LICENSE). Copyright (C) 2026 Dimitris Lolis.
