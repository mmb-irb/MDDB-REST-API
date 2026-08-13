# Changelog

## v0.0.16 — 2026-08-13

### Metadata and discoverability

- Added EBRAINS CodeMeta software metadata and a new `/rest/codemeta` endpoint so the API exposes machine-readable metadata for publication and discovery.

## v0.0.15 — 2026-07-28

Changes since v0.0.1 (2025-08-05).

### Architecture

- **Shared `mddb-database` package** — schemas, date-field definitions and pre-computed option counts moved out of the API into an npm-installed `mddb-database` dependency (first integrated as a git subtree, then converted to a proper package). The local `src/models` and the Mongo test helpers were removed as a result.
- **Legacy purge** — dropped the old `/chains` endpoint, the ligands code, and support for topology queries and topology options.

### New endpoints

- **`/uniprot`** — UniProt data lookup.
- **`/links/pointers`** and an extended `/pointers` — external pointers support, with resilience fixes for malformed pointer data.
- **`/stats`** — database statistics (collection sizes in TB, works on nodes without shards).
- **Knowledge endpoints** — SASA (absolute and relative, PDB-reference SAS, alignment-mismatch handling, funschema-validated), lipid–interaction (`lipid-inter`, replacing the `pdb-kb membrane` route), PDBe annotations, channel pore-facing residues, and `analysisType` in knowledge responses. Common logic factored into `knowledge/shared.js`.
- **FrameStep plot data** endpoint, with optional query filtering.

### Queries and references

- **Date queries** supported on projects, with date fields now defined centrally; resilient when stored dates are strings.
- **References** — query, projection and pagination; new `collections` reference; new searchable fields (InChIKey, UniProt IDs, CollectionID, Chain, syskeys).
- **Project options** — served from pre-computed counts, MD-level counts, new `search` argument, and graceful errors on bad query syntax.
- Replaced the deprecated `cursor.count()` with `countDocuments()`.

### Projects, MDs and files

- Deleted projects and MDs are excluded, with explicit handling for direct requests to deleted projects.
- `/inputs` reworked — explicit input filepaths as API URLs, per-MD topology, updated input fields, and a character-encoding fix.
- More versatile `/filenotes`; handles a project file and an MD file sharing a name; unnamed MDs are reported as `unnamed`.
- **Topology** — parses the new topology format, supports per-MD atom charges, tolerates unsorted atom indices, supports field filtering, and survives malformed topologies.
- Performance — uses `project.totalSize` instead of computing it per request, reduces the GridFS size aggregation to a single pipeline, adds `mdTime`, and makes summary growth more efficient.

### Observability

- **New metrics middleware** (`src/middlewares/metrics`) — migrated from Prometheus to OpenTelemetry logging (`OTEL_ENDPOINT`), with host and node information, request source, an `md_num` label, normalized route base paths, PM2 instance aggregation, `x-forwarded-for` support behind proxies, reduced cardinality, and per-host enabling via `.env`.
- Optional `swagger-stats` (development and host gated); internal hostname exposed in a response header; clearer developer-facing error logs and a `debug-logs` utility toggleable from `.env`.

### Deployment and documentation

- Deployment configurations for BSC, RPBS, INRIA, UFL and IT4I; new `HOST` and `PUBLIC_DIR` environment variables replacing hardcoded per-site fixes; Swagger base URL normalized to prevent redirect loops, with correct URLs for unknown hosts; OPTIMADE link hidden where unsupported; link `ping` support (requires Node > 18).
- Large Swagger/OpenAPI documentation rewrite covering the new query parameters, references and the trajectory endpoint.
- GitHub Actions workflow to check the package version on pull requests and propagate updates to dependent repositories.

### Fixes

Robustness fixes throughout: projects without metadata no longer break the API, `ObjectId` handling, unexpected query fields, explicit `bin` format requests, null MD names, project-formatter failure logging, and database statistics decimal formatting.
