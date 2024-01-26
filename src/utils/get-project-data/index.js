
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery, getMdIndex } = require('../get-project-query');
// Standard HTTP response status codes
const { NOT_FOUND, BAD_REQUEST, INTERNAL_SERVER_ERROR } = require('../status-codes');

// This function filters project data to a single MD
// Some project and MD files are merged such as metadata, metadata warnings, files and analyses
// Note that the input object is modified
const projectFormatter = (projectData, requestedMdIndex = null) => {
  // If the project has not the 'mds' field then it is wrong
  if (!projectData.mds) return {
    headerError: INTERNAL_SERVER_ERROR,
    error: 'Project is missing mds. Is it in an old format?'
  };
  // Get the index of the MD to remain
  const mdIndex = requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
  // Set the corresponding MD data as the project data
  const mdData = projectData.mds[mdIndex];
  // If the corresponding index does not exist then return an error
  if (!mdData) {
    const error = 'The requested MD does not exists. Try with numbers 1-' + projectData.mds.length;
    projectData.headerError = NOT_FOUND;
    projectData.error = error;
    return { headerError: NOT_FOUND, error: error };
  }
  const { name, frames, atoms, warnings, metadata, analyses, files, ...rest } = mdData;
  // Add the mdIndex and the mdNumber to the project itself
  // Note that this value has the same usage and importance than the accession
  projectData.mdIndex = mdIndex;
  projectData.mdNumber = mdIndex + 1;
  // Add the MD name to project metadata without overwritting the project name
  projectData.metadata.mdName = name;
  // Add also the atom and frames count
  projectData.metadata.mdAtoms = atoms;
  projectData.metadata.mdFrames = frames;
  // Project warnings and MD warnings are joined
  const projectWarnings = projectData.metadata.WARNINGS || [];
  const mdWarnings = warnings || [];
  projectData.metadata.WARNINGS = projectWarnings.concat(mdWarnings);
  // Add MD metadata to project metadata
  // Note that MD metadata does not always exist since most metadata is in the project
  // Note that project metadata values will be overwritten by MD metadata values
  Object.assign(projectData.metadata, metadata);
  // Merge project and MD analyses and return their names
  const projectAnalyses = projectData.analyses || [];
  const mdAnalyses = analyses || [];
  projectData.analyses = projectAnalyses.concat(mdAnalyses).map(analysis => analysis.name);
  // Merge project and MD files and return their names
  const projectFiles = projectData.files || [];
  const mdFiles = files || [];
  projectData.files = projectFiles.concat(mdFiles).map(file => file.name);
  // Add the rest of values
  // Note that project values will be overwritten by MD values
  Object.assign(projectData, rest);
  // Reduce the list of mds to their names
  projectData.mds = projectData.mds.map(md => md.name);
  // Rename the project "_id" as "internalId"
  projectData.internalId = projectData._id;
  delete projectData._id;
  // Rename the project "bid" as "identifier"
  projectData.identifier = projectData.bid;
  delete projectData.bid;
  // Return the modified object just for the map function to work properly
  return projectData;
};

// Give a requested project, find the id of a specific file by its filename
// If there is any problem send informative errors
const getProjectData = async (projects, request) => {
  // Find the project from the request
  // Return the project which matches the request accession
  // This is used by several endpoints so do not exclude any data
  const projectQuery = getProjectQuery(request);
  const rawProjectData = await projects.findOne(projectQuery);
  // If we did not found the project then stop here
  if (!rawProjectData) return { headerError: NOT_FOUND, error: 'Project was not found' };
  // Get the md index from the request or use the reference MD id in case it is missing
  const requestedMdIndex = getMdIndex(request);
  // If something went wrong with the MD request then return the error
  if (requestedMdIndex instanceof Error) return { headerError: BAD_REQUEST, error: requestedMdIndex.message };
  // Return the formatted data
  return projectFormatter(rawProjectData, requestedMdIndex);
}

module.exports = {
  projectFormatter,
  getProjectData
}