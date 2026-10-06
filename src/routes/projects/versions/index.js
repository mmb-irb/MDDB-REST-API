const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

// Get the versions of all data related to the requested project (references excluded)
// This includes the project metadata, the topology, every MD metadata and every analysis
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get raw project data, which includes all MDs
      // Note that the MD number in the request (if any) is ignored since we return versions for all MDs
      const projectData = await database.getRawProjectData(
        { 'metadata.ver': true, 'mds.name': true, 'mds.ver': true });
      // If something went wrong then return the error
      if (projectData.error) return projectData;
      // Get the version of every analysis, but not the analysis data itself
      const cursor = await database.analyses.find(
        { project: projectData._id },
        { projection: { _id: false, name: true, md: true, 'value.version': true } },
      );
      const analyses = await cursor.toArray();
      // Get the topology version, but not the topology data itself
      const topology = await database.topologies.findOne(
        { project: projectData._id },
        { projection: { _id: false, version: true } },
      );
      // Set the versions of project-wide analyses (i.e. those with no MD)
      const projectAnalyses = {};
      // Set the versions of every MD, including its analyses
      const mds = (projectData.mds || []).map(md => ({
        name: md.name,
        metadata: md.ver || null,
        analyses: {},
      }));
      analyses.forEach(analysis => {
        const version = (analysis.value && analysis.value.version) || null;
        if (analysis.md === undefined || analysis.md === null)
          projectAnalyses[analysis.name] = version;
        // MDs may have been removed while their analyses remain, so make sure the MD exists
        else if (mds[analysis.md]) mds[analysis.md].analyses[analysis.name] = version;
      });
      return {
        metadata: (projectData.metadata && projectData.metadata.ver) || null,
        topology: (topology && topology.version) || null,
        analyses: projectAnalyses,
        mds,
      };
    }
  }),
);

module.exports = router;
