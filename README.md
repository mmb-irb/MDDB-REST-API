## Requirements

Have Node.js and npm installed and working

## Setup

### Installation

1. Install the dependencies with `npm install` or `npm ci` (install exact dependencies as defined by `package-lock.json` file)
2. Create and fill an `.env` file in the root of the project (see [reference below](#.env-file-fields) for the keys)
3. Create and fill an `config.js` file in the root of the project
4. (Optional) Compile the trajectory format converters with `npm run build`. Otherwise, the trajectory endpoint will not be able to export from .bin to other formats. [Chemfiles](#chemfiles-installation) must be previously installed.
5. Start the server with `node index.js` or using a process manager like [PM2](http://pm2.keymetrics.io/) for example

### Test run

To simply run an instance of the API you must enter the API git repository and run the following command:
```bash
npm run start
```
If you have an error related to process 9229 yo may solvie it like this:
```bash
kill -9 lsof -t -i:9229
```

### PM2 Installation and run

PM2 is a deamon which handles the spawn and monitoring of API instances.
It is also useful to automatically respawn instances after failure.

In order to install pm2 run `npm install pm2`.<br/>
Once installed, head to the API directory and run 4 instances of it:<br/>
```bash
cd /path/to/api
pm2 start index.js -i 4 -n MDposit_API --node-args="--experimental-worker"
```
If you need to stop the API then do the following:
```bash
pm2 delete MDposit_API
```
Note that the API processes must be stopped and run again for new code to be effective after a 'git pull'.

### `.env` file fields

⚠️ No sensible default value is provided for any of these fields, they **need to be defined** ⚠️

| key              | value                         | description               |
| ---------------- | ----------------------------- | ------------------------- |
| NODE_ENV         | `test` or not defined         | to run a local fake mongo |
| DB_SERVER        | `<url>`                       | url of the db server      |
| DB_PORT          | number                        | port of the db server     |
| DB_NAME          | string                        | name of the db collection |
| DB_AUTH_USER     | string                        | db user                   |
| DB_AUTH_PASSWORD | string                        | db password               |
| DB_AUTHSOURCE    | string                        | authentication db         |
| LISTEN_PORT      | number                        | port to query the API     |
| HOST             | string                        | forced hostname           |
| PUBLIC_DIR       | string                        | path to public directory  |
| DEBUG            | boolean                       | log every request         |
| OTEL_ENDPOINT    | string                        | OTLP HTTP endpoint for logs |


### config.yml file

The host configuration sets the service name and description in the swagger docs, the accession example,
and how the API behaves (e.g. whether unpublished projects are hidden or it is the global API) depending on the requesting URL.

Every node defines its own configuration in a `config.yml` file at the repository root, which is ignored by git.
Without this file the API uses the default configuration for every host: a generic MDposit federated node
which shows unpublished projects (`production: false`).

Start from one of the examples, which describe every field and its default value:

* [example-single-config.yml](example-single-config.yml): one single configuration, used for every requesting host.
* [example-multiple-config.yml](example-multiple-config.yml): a different configuration for each host (domain) under `hosts`,
  e.g. a production and a development domain. Requests from other hosts get the default configuration.

Missing fields are filled with the default values, and unknown fields stop the API when it starts.
The file is read once when the API starts, so restart it after changing the file.
In the [MDDB-docker](https://github.com/mmb-irb/MDDB-docker) setup the file is `rest/config.yml`, which is copied into the image when it is built.

### chemfiles installation

Clone and install the [chemfiles fork](https://github.com/d-beltran/chemfiles) customized to support '.bin' format reading and streaming.
It is installed as a static library in the `build/chemfiles` directory of this repository, so no root permissions are needed.
The library is then embedded in the converter executable when running `npm run build`.

```bash
git clone https://github.com/d-beltran/chemfiles
cd chemfiles
mkdir build
cd build
cmake .. -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=<path to this repository>/build/chemfiles
make
make install
```

After updating the chemfiles fork, repeat the `make` and `make install` steps and then run `npm run build` again.

## MCP server

The API also serves an [MCP](https://modelcontextprotocol.io) server at `/rest/mcp` (e.g. `https://mmb.mddbr.eu/api/rest/mcp`),
so LLM clients can search projects, summarize analyses and topologies, read references and get checked download links.
Its tools call this same API through localhost, keeping the requesting host, so every host gets its own data.
Download links are built on the host clients requested, with the protocol in the `X-Forwarded-Proto` header if the proxy sets it.

To use it from a local client against any node's API, run it over stdio:

```bash
claude mcp add mddb -e MDDB_API_URL=https://irb.mddbr.eu/api/rest/v1/ -- node src/mcp/stdio.js
```

## Development

### Make a new version

1. Update the version in `package.json`, `package-lock.json`, commit the changes and create a tag with:
```bash
npm version X.Y.Z
```
2. Push the changes and the tag to the repository:
```bash
git push
git push origin vX.Y.Z

# Or in one line
VERSION=X.Y.Z && npm version $VERSION && git push && git push origin v$VERSION
```

Pushing the tag triggers the [Release workflow](.github/workflows/release.yml), which creates a GitHub release using the matching `## vX.Y.Z` section of [CHANGELOG.md](CHANGELOG.md) as the release notes. Add the changelog entry before pushing the tag, otherwise the release falls back to autogenerated notes.
