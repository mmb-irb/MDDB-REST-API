// Standard HTTP response status codes
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../status-codes');

// This function filters project data to a single MD
// Some project and MD files are merged such as metadata, metadata warnings, files and analyses
// Note that the input object is modified
const projectFormatter = (projectData, requestedMdIndex = null) => {
  // If the project has not the 'mds' field then it is wrong
  if (!projectData.mds) return {
    headerError: INTERNAL_SERVER_ERROR,
    error: 'Project is missing mds. Is it in an old format?'
  };
  // If the project has not the 'metadata' field then it is wrong
  if (!projectData.metadata) return {
    headerError: INTERNAL_SERVER_ERROR,
    error: 'Project is missing metadata, which should never happen. Was it added manually?'
  };
  // Get the index of the MD to remain
  const mdIndex = requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
  // Set the corresponding MD data as the project data
  const mdData = projectData.mds[mdIndex];
  // If the corresponding index does not exist then return an error
  if (!mdData) {
    const error = projectData.booked
      ? 'The requested accession is booked but is not available yet.'
      : `The requested MD does not exist. Please try with numbers between 1 and ${projectData.mds.length}.`;
    projectData.headerError = NOT_FOUND;
    projectData.error = error;
    return { headerError: NOT_FOUND, error: error, accession: projectData.accession };
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
  projectData.mds = projectData.mds.map(md => md && (md.name || 'unnamed') + (md.removed ? ' (removed)' : ''));
  // Rename the project "_id" as "internalId"
  projectData.internalId = projectData._id;
  projectData.creationDate = projectData._id.getTimestamp();
  delete projectData._id;
  // Set the identifier
  // This id is the one to be used by the client to ask for more data about the same project
  projectData.identifier = projectData.accession || projectData.internalId;
  // Return the modified object just for the map function to work properly
  return projectData;
};

module.exports = projectFormatter;