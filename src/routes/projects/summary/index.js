const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getBaseFilter } = require('../../../utils/get-project-query');

const analysisRouter = Router({ mergeParams: true });

// Set a header for queried fields to be queried in the references collection instead of projects
const referencesHeader = 'references.';

// Try to parse JSON and return the bad request error in case it fails
const parseJSON = string => {
  try {
    const parse = JSON.parse(string);
    if (parse && typeof parse === 'object') return parse;
  } catch (e) {
    return false;
  }
};

// This endpoint returns some summary of data contained in the projects collection
module.exports = (_, { projects }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Set an object with all the parameters to performe the mongo query
        // Start filtering by published projects only if we are in production environment
        const finder = getBaseFilter(request);
        // Handle when there is a mongo query
        let query = request.query.query;
        if (query) {
          // In case there is a single query it would be a string, not an array, so adapt it
          if (typeof query === 'string') query = [query];
          for (const q of query) {
            // Parse the string into an object
            const projectsQuery = parseJSON(q);
            if (!projectsQuery) return {
              headerError: BAD_REQUEST,
              error: 'Wrong query syntax: ' + q
            };
            // At this point the query object should correspond to a mongo query itself
            // Find fields which start with 'references'
            // These fields are actually intended to query the references collections
            // If we found references fields then we must query the references collection
            // Then each references field will be replaced by a query to 'metadata.REFERENCES' in the projects query
            // The value of 'metadata.REFERENCES' to be queried will be the matching uniprot ids
            const parseReferencesQuery = async original_query => {
              // Iterate over the original query fields
              for (const [field, value] of Object.entries(original_query)) {
                // If the field is actually a list of fields then run the parsing function recursively
                if (field === '$and' || field === '$or') {
                  for (const subquery of value) {
                    await parseReferencesQuery(subquery);
                  }
                  return;
                }
                // If the field does not start with the references header then skip it
                if (!field.startsWith(referencesHeader)) return;
                // Get the name of the field after substracting the symbolic header
                const referencesField = field.replace(referencesHeader, '');
                const referencesQuery = {};
                referencesQuery[referencesField] = value;
                // Query the references collection
                // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
                const referencesCursor = await model.references
                  .find(referencesQuery)
                  .project({ uniprot: true, _id: false });
                const results = await referencesCursor
                  .map(ref => ref.uniprot)
                  .toArray();
                // Update the original query by removing the original field and adding the parsed one
                delete original_query[field];
                original_query['metadata.REFERENCES'] = { $in: results };
              }
            };
            // Start the parsing function
            await parseReferencesQuery(projectsQuery);
            if (!finder.$and) finder.$and = [];
            finder.$and.push(projectsQuery);
          }
        }
        // Get all projects
        const cursor = await projects.find(
          finder,
          // Discard the heaviest fields we do not need anyway
          {
            projection: {
              id: false,
              'metadata.pdbInfo': false,
              'metadata.INTERACTIONS': false,
              'metadata.CHARGES': false,
              'metadata.SEQUENCES': false,
              'metadata.DOMAINS': false,
            },
          },
        );
        // Consume the cursor
        const data = await cursor.toArray();
        // Set the summary object to be returned
        // Then all mined data will be written into it
        const summary = {};
        // Get the number of projects
        summary['projectsCount'] = data.length;
        // Count the number of MDs
        let mdCount = 0;
        data.forEach(project => {
          // If it is the old format then it only counts as 1 MD
          if (!project.mds) return mdCount += 1;
          // Otherwise, count the number of MDs
          mdCount += project.mds.length;
        });
        summary['mdCount'] = mdCount;
        // Get the total MD time
        const totalTime = data
          .map(project => {
            const metadata = project.metadata;
            if (!metadata) return 0;
            const length = +metadata.LENGTH;
            const mds = project.mds;
            if (!mds) return length;
            // DANI: Esto no es del todo preciso, pues podrían haber réplicas con menos frames (e.g. las moonshot)
            // DANI: Esto se solucionará al reemplazar el campo de LENGTH for el de FRAMESTEP
            return length * mds.length;
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalTime'] = totalTime;
        // Get the total MD number of frames
        const totalFrames = data
          .map(project => {
            const metadata = project.metadata;
            if (!metadata) return 0;
            const mds = project.mds;
            if (!mds) return +metadata.SNAPSHOTS;
            return mds.reduce((acc, curr) => (acc + curr.frames), 0);
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalFrames'] = totalFrames;
        // Get the total number of files
        const totalFiles = data
          .map(project => {
            const mds = project.mds;
            if (!mds) {
              const files = project.files;
              if (!files) return 0;
              return files.length;
            }
            return mds.reduce((acc, curr) => (acc + curr.files.length), 0);
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalFiles'] = totalFiles;
        // Get the total number of analyses
        const totalAnalyses = data
          .map(project => {
            const mds = project.mds;
            if (!mds) {
              const analyses = project.analyses;
              if (!analyses) return 0;
              return analyses.length;
            }
            return mds.reduce((acc, curr) => (acc + curr.analyses.length), 0);
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalAnalyses'] = totalAnalyses;
        // Send all mined data
        return summary;
      },
      // If there is nothing retrieved send a INTERNAL_SERVER_ERROR status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(INTERNAL_SERVER_ERROR);
      },
      // If there is retrieved and the retrieved then send it
      body(response, retrieved) {
        if (!retrieved) response.end();
        response.json(retrieved);
      },
    }),
  );

  return analysisRouter;
};
