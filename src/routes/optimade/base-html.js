// Returns the OPTIMADE HTML landing page for base URLs (/optimade/ and /optimade/v1/).
// Per the OPTIMADE spec, the base URL should return a human-readable page when accessed
// via a browser. JSON data for programmatic access is available at /optimade/v1/info.
const { OPTIMADE_VERSION, PROVIDER, IMPLEMENTATION, getBaseUrl } = require('./utils');

// Build the URL carefully so it works both locally and behind a reverse proxy
function getBaseHtml(request) {
  const base = getBaseUrl(request);

  const endpointLinks = ['links', 'references', 'trajectories', 'structures', 'info']
    .map(ep => `<li><a href="${base}/${ep}">${base}/${ep}</a></li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>OPTIMADE – ${PROVIDER.name}</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="keywords" content="optimade,materials,molecular dynamics,database">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
    <style>
      html { margin: 2em; font-family: sans-serif; }
      h4, p { margin-left: 2em; }
      span.version {
        background-color: lightgrey;
        font-weight: bold;
        font-family: monospace;
        padding: 0em 0.5em;
        border-radius: 1em;
      }
    </style>
  </head>
  <body>
    <img width="100"
         src="https://matsci.org/uploads/default/original/2X/b/bd2f59b3bf14fb046b74538750699d7da4c19ac1.svg"
         alt="OPTIMADE logo">
    <h3>This is an <a href="https://www.optimade.org">OPTIMADE</a> base URL which can be queried with an OPTIMADE client.</h3>

    <h3>OPTIMADE version:</h3>
    <h3><span class="version">${OPTIMADE_VERSION}</span></h3>

    <h3>Provider:</h3>
    <h4>${PROVIDER.name}</h4>
    <p>Prefix: <span class="version">${PROVIDER.prefix}</span></p>
    <p>${PROVIDER.description}</p>
    <p><a href="${PROVIDER.homepage}">${PROVIDER.homepage}</a></p>

    <h3>Implementation:</h3>
    <h4>${IMPLEMENTATION.name}</h4>
    <p>Version: <span class="version">${IMPLEMENTATION.version}</span></p>
    <p><a href="${IMPLEMENTATION.source_url}">${IMPLEMENTATION.source_url}</a></p>

    <h3>Available endpoints:</h3>
    <ul>
      ${endpointLinks}
    </ul>
  </body>
  <footer>
    <div>
      <ul style="list-style-type:none; margin:0; padding:0; overflow:hidden; margin-top:2em">
        <li style="padding-top:5px">
          Compliant with the
          <i class="fa fa-github"></i>
          <a href="https://github.com/Materials-Consortia/OPTIMADE">OPTIMADE specification</a>.
        </li>
      </ul>
    </div>
  </footer>
</html>`;
}

module.exports = getBaseHtml;
