## Requirements

Have Node.js and npm installed and working

## Setup

### Installation

1. Install the dependencies with `npm install` or `npm ci` (install exact dependencies as defined by `package-lock.json` file)
2. Create and fill an `.env` file in the root of the project (see [reference below](#.env-file-fields) for the keys)
3. Create and fill an `config.js` file in the root of the project
4. (Optional) Compile the trajectory format converters with `npm run build`. Otherwise, the trajectory endpoint will not be able to export from .bin to other formats. [Chemfiles](#chemfiles-installation) must be previously installed.
5. Start the server with `node index.js` or using a process manager like [PM2](http://pm2.keymetrics.io/) for example

### PM2 Installation and run

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

### config.yml file

You may need to edit this file as well to customize your swagger documentation and define
how the API should behave depending on the requesting URL.<br/>
The file in the repository provides an explanation on every field and several examples.

### chemfiles installation

Clone and install the [chemfiles fork](https://github.com/d-beltran/chemfiles) customized to support '.bin' format reading and streaming.

```bash
git clone https://github.com/d-beltran/chemfiles
cd chemfiles
mkdir build
cd build
cmake ..
make
sudo make install
```
