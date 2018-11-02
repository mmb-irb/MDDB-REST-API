const express = require("express");

const app = express();
const PORT = 8000;

app.get("/", (_, res) => res.send("Hello world!"));

module.exports = {
  app,
  start() {
    app.listen(PORT, () => console.log(`API running on localhost:${PORT}`));
  }
};
