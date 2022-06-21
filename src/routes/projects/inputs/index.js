const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');

const analysisRouter = Router({ mergeParams: true });

// This endpoint builds the MoDEL workflow's 'inputs.json' file
module.exports = (_, { projects }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      retriever(request) {
        // Return the project which matches the request accession
        return projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // But return only the "metadata" attribute
          { projection: { _id: false, metadata: true } },
        );
      },
      // If there is nothing retrieved send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has metadata then send the inputs file
      body(response, retrieved) {
        if (retrieved) {
          const metadata = retrieved.metadata;
          // Prepare the input interactions as only interaction names and selections
          const interactions = metadata.INTERACTIONS;
          if (interactions) {
            for (const interaction of interactions) {
              delete interaction.residues_1;
              delete interaction.residues_2;
              delete interaction.interface_1;
              delete interaction.interface_2;
            }
          }
          // Prepare the inputs json file to be sent
          if (metadata) {
            const inputs = {
              chainnames: metadata.CHAINNAMES,
              ligands: metadata.LIGANDS,
              domains: metadata.DOMAINS,
              interactions: interactions,
              references: metadata.REFERENCES,
              unit: metadata.UNIT,
              pdbIds: metadata.PDBIDS,
              name: metadata.NAME,
              description: metadata.DESCRIPTION,
              contact: metadata.CONTACT,
              authors: metadata.AUTHORS,
              groups: metadata.GROUPS,
              program: metadata.PROGRAM,
              version: metadata.VERSION,
              method: metadata.METHOD,
              links: metadata.LINKS,
              license: metadata.LICENSE,
              linkcense: metadata.LINKCENSE,
              citation: metadata.CITATION,
              thanks: metadata.THANKS,
              length: metadata.LENGTH,
              temp: metadata.TEMP,
              ensemble: metadata.ENSEMBLE,
              timestep: metadata.TIMESTEP,
              ff: metadata.FF,
              wat: metadata.WAT,
              boxtype: metadata.BOXTYPE,
              exceptions: metadata.EXCEPTIONS,
              membranes: metadata.MEMBRANES,
            };
            response.json(inputs);
          } else response.json({ error: 'There is no metadata' });
        } else response.end();
      },
    }),
  );

  return analysisRouter;
};
