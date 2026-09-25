# Listing sources

Houser shows the homes in the JSON files in `data/`. It ships no listings and no connectors. `data/` is ignored by Git.

## Import a file

```json
{
  "source": "My list",
  "fetchedAt": "2026-09-25T10:00:00Z",
  "country": "CH",
  "currency": "CHF",
  "listings": [
    {
      "id": "my-list:1",
      "coordinates": [8.5313, 47.3857],
      "price": 2200,
      "title": "2½ rooms near the river",
      "address": "Limmatstrasse 1, 8005 Zürich",
      "kind": "apartment",
      "rooms": 2.5,
      "areaM2": 75,
      "furnished": false,
      "availableFrom": "2026-11-01",
      "image": "https://example.com/photos/1.jpg",
      "sourceUrl": "https://example.com/homes/1",
      "coordinateAccuracy": "exact"
    }
  ]
}
```

File fields:

| Field | Required | Notes |
| --- | --- | --- |
| `listings` | yes | Array of homes |
| `source` | no | Name shown with the homes. Defaults to the file name |
| `fetchedAt` | no | ISO 8601. Defaults to the file's modification time |
| `country` | no | ISO 3166 code for homes without one |
| `currency` | no | ISO 4217 code for homes without one |

Home fields:

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Unique across all files |
| `coordinates` | yes | `[longitude, latitude]` |
| `price` | yes | Monthly rent |
| `currency` | yes, unless set on the file | ISO 4217 |
| `country` | no | ISO 3166 |
| `title`, `address` | no | Text |
| `kind` | no | `room`, `studio`, `apartment` or `house` |
| `rooms`, `bedrooms`, `areaM2` | no | Numbers |
| `furnished` | no | Boolean |
| `availableFrom` | no | `YYYY-MM-DD` |
| `image`, `sourceUrl` | no | https URLs |
| `coordinateAccuracy` | no | `exact` or `approximate` |

Homes missing a required field are skipped, as are values of the wrong type. `GET /api/sources` shows what each file gave. Files are read again when they change.

## Write a connector

A connector is a module in `server/sources/` that returns homes in the format above:

```js
export default {
  id: 'example',
  name: 'Example',
  searchUrl: ([west, south, east, north]) => `https://example.com/search?bbox=${west},${south},${east},${north}`,
  async fetch({ onProgress }) {
    return []
  },
}
```

`searchUrl` is optional. Add the connector to `server/sources/index.mjs`, then run `npm run homes:fetch`, or `npm run homes:fetch -- example` for just that one. The homes are saved to `data/example.json`.

Check a source's terms before using it.
