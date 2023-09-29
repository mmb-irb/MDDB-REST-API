
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery, getMdIndex } = require('../get-project-query');
// Standard HTTP response status codes
const { NOT_FOUND, BAD_REQUEST } = require('../status-codes');

// Give a requested project, find the id of a specific file by its filename
// If there is any problem send informative errors
const getProjectData = async (projects, request) => {
  // Find the project from the request
  // Get the ID from the previously found file and save the file through the ID
  // Return the project which matches the request accession
  const projectData = await projects.findOne(
    getProjectQuery(request),
    // Retrieve only the fields which may include files data
    {
      projection: {
        // Id and accession may be useful to name a downloaded file
        _id: true, accession: true,
        files: true,
        'mds.files': true,
        mdref: true,
      },
    },
  );
  // If we did not found the project then stop here
  if (!projectData) return {
    headerError: NOT_FOUND,
    error: 'Project was not found'
  };
  // Get the md index from the request or use the reference MD id in case it is missing
  const requestedMdIndex = getMdIndex(request);
  // If something went wrong with the MD request then return the error
  if (requestedMdIndex instanceof Error) return {
    headerError: BAD_REQUEST,
    error: requestedMdIndex.message
  };
  // Return project data and the requested MD Index
  return { projectData, requestedMdIndex };
}

// Give a requested project, find the id of a specific file by its filename
// If there is any problem send informative errors
const getFileId = (projectData, requestedMdIndex, targetFilename) => {
  // Declare the file id to further store its value
  let fileId;
  // If the project has the 'mds' field then it means it has the new format
  // Find the file among the corresponding MD files list
  if (projectData.mds) {
    // Get the MD index, which is the requested index or, if none, the reference index
    const mdIndex =
      requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
    // Get the corresponding MD data and return its analysis names
    const mdData = projectData.mds[mdIndex];
    // If the corresponding index does not exist then return an error
    if (!mdData) return {
      headerError: NOT_FOUND,
      error: 'The requested MD does not exists. Try with numbers 1-' + projectData.mds.length
    };
    // Find the file with the requested name
    const file = mdData.files.find(
      file => file.name === targetFilename,
    );
    // If the file is not found then return a not found error
    if (!file) return {
      headerError: NOT_FOUND,
      error: 'The requested project does not contain a file named ' + targetFilename
    };
    // Finally set the file id
    fileId = file.id;
  }
  // If the project has not the 'mds' field then it means it has the old format
  // Return its analyses, as before
  else {
    // Make sure no md was requested or raise an error to avoid silent problems
    // User may think each md returns different data otherwise
    if (requestedMdIndex !== null) return {
      headerError: BAD_REQUEST,
      error: 'This project has no MDs. Please use the accession or id alone.'
    };
    // Find the file with the requested name
    const file = projectData.files.find(
      file => file.filename === targetFilename,
    );
    // If the file is not found then return a not found error
    if (!file) return {
      headerError: NOT_FOUND,
      error: 'The requested project does not contain a file named ' + targetFilename
    };
    // Finally set the file id
    fileId = file._id;
  }
  // Return the file id inside an object to make it coherent with error messages
  // Return also the project data in case it is usefull
  return { fileId, projectData };
}

module.exports = {
  getProjectData,
  getFileId
}