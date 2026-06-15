const formatKnowledgeDate = (dateValue) => {
    const date = new Date(dateValue);
    return `${date.getMonth()}/${date.getDate()}/${date.getFullYear()}`;
};

const buildKnowledgeResponse = ({
    resourceVersion,
    resourceEntryUrl,
    modelCoordinatesUrl,
    releaseDate,
    pdbId,
    sourceId,
    analysisType,
    chains,
    sites,
}) => ({
    data_resource: 'MDDB',
    resource_version: resourceVersion,
    resource_entry_url: resourceEntryUrl,
    model_coordinates_url: modelCoordinatesUrl,
    release_date: releaseDate,
    pdb_id: pdbId,
    additional_entry_annotations: {
        source_id: sourceId,
        annotation_type: analysisType,
    },
    chains,
    evidence_code_ontology: [{
        eco_term: 'molecular dynamics evidence used in automatic assertion',
        eco_code: 'ECO_0006373',
    }],
    sites,
});

module.exports = {
    buildKnowledgeResponse,
    formatKnowledgeDate,
};