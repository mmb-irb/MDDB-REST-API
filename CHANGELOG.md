# Changelog

## Unreleased

### Breaking changes

- **Only one `config.yml` format**: root keys are the host names, each one with its own configuration inside (see `example-config.yml`, which replaces `example-single-config.yml` and `example-multiple-config.yml`). Configuration fields at the root (the single configuration format of v0.0.20) and the `hosts` field (the format before) stop the API when it starts. To use one configuration for every request, no matter the host it arrives with, configure one single host and force it with `HOST` in the `.env` file.
- **`config.yml` is mandatory**: the API does not start without it, with an empty file, or with a `HOST` in the `.env` file which is not configured.

### Fixes

- The OPTIMADE API and web client links in the swagger docs of unrecognized hosts (and of every host with a single configuration in v0.0.20) pointed to `//null`.

## v0.0.20 — 2026-11-12

Changes since v0.0.19 (2026-11-09).

### Breaking changes

- **`config.yml` is no longer in the repository**: every node keeps its own one at the repository root, ignored by git. Without it the API uses a generic default configuration (`MDposit`, accession `A0001`, `production: false`) for every host, so **create it before deploying this version**. Start from `example-single-config.yml` (one configuration for every host) or `example-multiple-config.yml` (one per host under `hosts`, as before). Missing fields take default values and unknown fields stop the API when it starts.

### Fixes

- The swagger docs of an unrecognized host no longer keep the host name of the first unrecognized request for later ones.
- The inputs file (`/projects/{project}/inputs`) points to the structure file of every MD, mmCIF or PDB: it always pointed to `structure.pdb`, so downloading with the workflow the projects which only have `structure.cif` failed. File URLs are no longer broken when the inputs file is requested with a format (e.g. `?format=json`).

## v0.0.19 — 2026-11-09

Changes since v0.0.18 (2026-10-26).

### Breaking changes

- **The `query` and `projection` arguments are removed** from every endpoint and API version, since they passed mongo code directly to the database.
  - Use **`filter`** instead of `query` in `/projects`, `/projects/options`, `/projects/summary`, `/projects/summary/framestep`, `/stats` and `/references/{reference}`.
  - Use **`return`** instead of `projection` in `/projects`, `/projects/options`, `/references/{reference}` and `/pointers`.
- **New `filter` syntax**: a field, an operator and a value (e.g. `uniprotOrganism=eq='Homo sapiens'`). Operators are `=eq=`, `=ne=`, `=ct=` (contains, case insensitive), `=nc=` (does not contain), `=gt=`, `=ge=`, `=lt=` and `=le=`, and the symbols `==`, `!=`, `~=`, `!~=`, `>`, `>=`, `<` and `<=` are supported as well. Text values must be quoted with single quotes, so they may include any character (quotes inside may be escaped with `\`), while numbers, booleans and dates may be quoted or not. Several values may be separated by `,`. An empty value with `=eq=` or `=ne=` stands for fields with no value (e.g. `pdbId=eq=`). Several conditions may be separated by `;` in a single filter and they are combined with OR (e.g. `uniprotOrganism=eq='Homo sapiens';pdbOrganism=eq='Homo sapiens'`), while several filters are combined with AND. The syntax only relies on characters which do not need to be percent encoded in URLs. The old `++`, `+*`, `--` and `-*` operators are no longer supported.
- `return` takes field names separated by commas (e.g. `return=name,author`).
- Fields may be passed by their full path or by their alias (e.g. `uniprotOrganism` for `references.proteins.organism`), as defined in the `QUERY_FIELDS` of `mddb-database`. Aliases mean the same field in every endpoint, so `/references/{reference}` also takes aliases or full paths (e.g. `uniprotGene` or `references.proteins.gene`) instead of fields relative to the reference. Values are parsed according to the field type, and wrong filters are rejected with a 400 error explaining the problem.
- **Unsupported arguments are rejected** with a 400 error in every endpoint, in the query or the body.
- **Pagination limits greater than the maximum** of each endpoint are rejected with a 400 error stating the maximum, instead of being silently capped. Wrong `page` and `limit` values are rejected too, instead of being replaced by defaults.

### API versions

- **REST API v2** is added and `current` points to it. Every version is served from the same routes, responses include an `X-API-Version` header, and unknown versions (e.g. `/rest/v9`) return a 404 listing the available ones.
- Since v2, `/structure` returns **mmCIF** and `/trajectory` returns **xtc** by default. v1 keeps PDB and bin, and an explicit `format` is respected in every version.

### MCP server

- **An MCP server is served at `/rest/mcp`**, so LLM clients can use every API host through tools: search projects, count field values, read projects, summarize analyses and topologies, look up residues and atoms, read references, find the simulations of a reference and get download links. Results over 40k characters are refused with a list of their parts.
- Browsers get a page at `/rest/mcp` on how to connect to it, with the configuration files of the main clients (Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, Codex). It is listed in the `/rest` index and documented in Swagger.
- `src/mcp/stdio.js` runs the same tools over stdio against any node's API, for local clients.

### New endpoints and arguments

- **`/references/{reference}/versions`** — versions of all references of a type, with references without version as 0.0.0.
- **`/projects/{id}/trajectory/coordinates`** — always returns the binary trajectory, with the same selections as `/trajectory`.
- **`ids` argument and POST support** in `/projects` and `/references/{reference}`, so long lists of ids fit. Any argument of any endpoint may be passed in the query or in the JSON body.

### Topology, structure and trajectory

- `/structure` supports **mmCIF** (`format=mmcif`), and NGL selections are always parsed from a mmCIF, so they work with long chain names and residue numbers over 9999.
- New **`numbering`** argument (`author` or `uniprot`) to choose the residue numeration in structure and trajectory.
- `/trajectory` supports **Amber NetCDF** (`nc`) and **DCD** formats, and XTC and TRR trajectories include the simulation box.
- `/structure` no longer requires the stored structure file.
- Topology selections may be per-MD and grouped in `[first, last]` ranges.
- The chemfiles converter is built without root permissions, as a static library in `build/chemfiles`.

### Queries and docs

- The `/projects` docs list the queryable fields with their type, description and an example.
- Fixed queries with several reference fields of the same type, nested reference fields (e.g. `references.inchikeys.ligand.name`), and reference or date fields after other fields or inside `$and`/`$or`.
- `/projects/options` refuses counting fields which hold objects, naming the fields to count instead.
- The internal `pending_deletions` field of projects is hidden.

### Security

- Huge ranges and numbers, zero steps and out-of-range index lists in selections are rejected with a 400 error, instead of running the API out of memory or reading beyond the trajectory file.

## v0.0.18 — 2026-10-26

Changes since v0.0.17 (2026-09-02).

### Deployment

- **Node.js 26.12.1 or newer is now required** (`engines` in `package.json`). It includes the October 2026 Node.js security releases (Brotli decoder RCE, TLS hostname verification bypasses, among 10 CVEs).
- **`package-lock.json` is now tracked**, so deployments install the exact tested dependency versions.

### Security and dependencies

- `npm audit` goes from 108 vulnerabilities to none: express 4.22, jsdom 30, OpenTelemetry 0.300 and updated dev tools (jest 30, eslint 10, prettier 3, nodemon 3, pm2 7).
- Fixed Grafana metrics, which OpenTelemetry 0.300 would have stopped exporting silently.

### New endpoints

- **OPTIMADE** API (v1.2) at `/optimade`, for both local and global databases, shown by default in the docs.
- **`/projects/{id}/versions`** — versions of the project metadata, topology, MDs and analyses.
- **`/projects/{id}/trajectory/box`** — simulation box per frame in binary format, with frame selection.
- **Reference files** — `/references/{reference}/{id}/files` and `/files/{filename}`, also in the global API.

### Topology, structure and trajectory

- Topology supports per-atom and per-residue fields stored as binary files in GridFS, atom/residue/chain selections with renumbered indices, deduplicated bonds by default (`dupbonds` to get them in both atoms) and atoms with missing bonds.
- `resindices` and `chaindices` selections in structure and trajectory.
- `/structure` is always built from the topology, loading only the fields the PDB needs.
- Fixed atom numbers in PDB files with more than 100k atoms.
- Ranged selections reject negative, malformed and out-of-limit indices.

### Performance

- JSON and PDB responses are compressed (brotli/gzip); binary trajectories are not, so they keep their content length.

### Other

- Nodes may define an `api_dev_url` besides `api_url`.
- Fixed several latent bugs reported by the new linter (implicit globals, swagger docs placeholder replacement).

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
