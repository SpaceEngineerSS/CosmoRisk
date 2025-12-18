# 🛸 NASA API Integration

CosmoRisk uses the **NASA NeoWs (Near Earth Object Web Service)** API for real asteroid data.

## Getting Your API Key

1. Visit [api.nasa.gov](https://api.nasa.gov/)
2. Fill in your email
3. Receive instant API key
4. **Free tier:** 1,000 requests/hour

## API Endpoints Used

### Browse NEOs
```
GET https://api.nasa.gov/neo/rest/v1/neo/browse
```
Returns paginated list of all known NEOs.

### Feed (Date Range)
```
GET https://api.nasa.gov/neo/rest/v1/feed?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```
Returns NEOs with close approaches in date range.

### Single NEO
```
GET https://api.nasa.gov/neo/rest/v1/neo/{asteroid_id}
```
Returns detailed data for specific asteroid.

## Data Retrieved

| Field | Description |
|-------|-------------|
| `name` | Asteroid name/designation |
| `neo_reference_id` | Unique NASA ID |
| `absolute_magnitude_h` | Brightness (size indicator) |
| `estimated_diameter` | Size range in meters |
| `is_potentially_hazardous` | Boolean (MOID < 0.05 AU, H < 22) |
| `orbital_data` | Keplerian elements |
| `close_approach_data` | Future Earth encounters |

## Orbital Elements Parsed

| Element | API Field |
|---------|-----------|
| Semi-major axis (AU) | `semi_major_axis` |
| Eccentricity | `eccentricity` |
| Inclination (deg) | `inclination` |
| Longitude of Ascending Node | `ascending_node_longitude` |
| Argument of Perihelion | `perihelion_argument` |
| Mean Anomaly | `mean_anomaly` |
| Epoch | `epoch_osculation` |

## Rate Limiting

| Tier | Limit |
|------|-------|
| Free (DEMO_KEY) | 30 requests/hour |
| Free (with key) | 1,000 requests/hour |
| Enterprise | Contact NASA |

## Error Handling

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 403 | Invalid API key |
| 429 | Rate limit exceeded |
| 503 | Service unavailable |

## Caching

CosmoRisk caches asteroid data locally to:
- Reduce API calls
- Enable offline viewing
- Improve performance

Cache is stored in application data directory.

---

[← Deflection Methods](Deflection-Methods) | [Next: FAQ →](FAQ)
