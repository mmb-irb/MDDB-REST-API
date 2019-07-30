## Requirements

Have Node.js and npm installed and working

## Setup

### development

1. Install the dependencies with `npm install`
2. Create and fill and `.env` file in the root of the project (see [reference below](#.env-file-fields) for the keys)
3. Start development server with `npm run start`

### production

1. Install the dependencies with `npm ci` (install exact dependencies as defined by `package-lock.json` file)
2. Create and fill and `.env` file in the root of the project (see [reference below](#.env-file-fields) for the keys)
3. Start the server with `node index.js` or using a process manager like [PM2](http://pm2.keymetrics.io/) for example

### `.env` file fields

⚠️ No sensible default value is provided for any of these fields, they **need to be defined** ⚠️

| key              | value                         | description               |
| ---------------- | ----------------------------- | ------------------------- |
| NODE_ENV         | `development` or `production` | dev or prod flag          |
| DB_SERVER        | `<url>`                       | url of the db server      |
| DB_PORT          | number                        | port of the db server     |
| DB_NAME          | string                        | name of the db collection |
| DB_AUTH_USER     | string                        | db user                   |
| DB_AUTH_PASSWORD | string                        | db password               |
| DB_AUTHSOURCE    | string                        | authentication db         |
