const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { version } = require('../../package.json');
const { getAnalysis } = require('./analyses');
const { DATA, FORMATS, getDownloadUrl } = require('./downloads');
const { FIELD_CATALOG, getProject, projectOptions, searchProjects } = require('./projects');
const { findSimulations, getReferences, REFERENCE_TYPES } = require('./references');
const { getTopology } = require('./topology');
const { NUMBERINGS } = require('../utils/topology-tools');

const INSTRUCTIONS = `MDDB is a federated database of atomistic molecular dynamics (MD) simulations. \
Each project is one simulated system with one or more MD replicas, stored on one node (IRB Barcelona, Oxford, Inria...). \
Accessions look like A0001 on a node and MD-A00001 in the global database; append .N to pick the Nth MD, e.g. A01YJ.2.`;

const QUERY_DESCRIPTION = 'MongoDB filter on stored project fields; conditions are ANDed';
const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

const json = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

// One MCP server over an API (the JSON it answers) and a probe (the headers of its downloads)
const createServer = (api, probe) => {
  const server = new McpServer({ name: 'mddb', version }, { instructions: INSTRUCTIONS });

  server.registerTool('search_projects', {
    title: 'Search MD projects',
    description: `Search MDDB simulation projects. Returns the total number of matches and one compact row per \
project: accession, node, name, keywords, atom count, number of MDs, total frames and simulated time (ns), PDB and \
UniProt ids.

Filter with \`text\` (free text over names, descriptions, authors and groups) and/or \`query\`, a MongoDB filter on \
the fields listed below. Examples:
- {"metadata.SYSKEYS": "membrane"}
- {"references.proteins.gene": "ACE2", "metadata.TYPE": "trajectory"}
- {"metadata.PROTSEQ": {"$regex": "SFELLHAPATV"}} (a protein sequence motif, here of the SARS-CoV-2 spike)
- {"metadata.TEMP": {"$gte": 310}}
- {"updateDate": {"$gt": "2026-01-01"}} (dates as ISO strings)
references.* fields are matched in the UniProt, PDB and ligand records that projects refer to.

Which fields a project has depends on the workflow version that uploaded it, so some projects lack some fields. \
\`missingFields\` gives, for each queried field, how many projects in the whole database don't have it.

Call project_options first to see which values a field actually takes. Add more stored fields to every row with \
\`fields\`, e.g. ["metadata.FF", "metadata.TEMP"].

Queryable fields:
${FIELD_CATALOG}`,
    inputSchema: {
      text: z.string().optional().describe('Free-text search'),
      query: z.record(z.string(), z.unknown()).optional().describe(QUERY_DESCRIPTION),
      fields: z.array(z.string()).optional().describe('Extra dotted field paths to include in every row'),
      sort: z.record(z.string(), z.union([z.literal(1), z.literal(-1)])).optional()
        .describe('MongoDB sort, e.g. {"updateDate": -1}. Default: by accession'),
      limit: z.number().int().min(1).max(100).default(10),
      page: z.number().int().min(1).default(1),
    },
    annotations: READ_ONLY,
  }, async args => json(await searchProjects(api, args)));

  server.registerTool('project_options', {
    title: 'Count field values',
    description: `Count how many projects have each value of one or more fields, most frequent first, e.g. \
the force fields in use, or which UniProt ids have the most simulations. Narrow it with the same \`text\` and \
\`query\` as search_projects. Values beyond \`top\` are summed up in otherValues (how many) and otherCount. A project \
counts once for every value of a list field.`,
    inputSchema: {
      fields: z.array(z.string()).min(1).describe('Dotted field paths, e.g. ["metadata.FF", "metadata.SYSKEYS"]'),
      text: z.string().optional().describe('Free-text search'),
      query: z.record(z.string(), z.unknown()).optional().describe(QUERY_DESCRIPTION),
      top: z.number().int().min(1).max(500).default(30).describe('Values to list per field'),
    },
    annotations: READ_ONLY,
  }, async args => json(await projectOptions(api, args)));

  server.registerTool('get_project', {
    title: 'Get a project',
    description: `Get one project's metadata (authors, citation, license, force field, temperature, composition, \
sequences, references...), its MDs, and the analyses and files available for the selected MD. Empty fields and \
viewer settings are left out.`,
    inputSchema: {
      accession: z.string().describe('e.g. A0001, MD-A00001, or A01YJ.2 for its second MD'),
    },
    annotations: READ_ONLY,
  }, async ({ accession }) => json(await getProject(api, accession)));

  server.registerTool('get_analysis', {
    title: 'Read an analysis',
    description: `Read one analysis of an MD, e.g. rmsds, rmsd-perres, rmsd-pairwise, fluctuation, rgyr, sasa, pca, \
tmscores, pockets, clusters, interactions, hbonds, energies, dist-perres, helical, density, thickness, apl, \
lipid-order, lipid-inter, channels, markov. get_project lists the ones the MD has.

Without \`path\` it returns the whole analysis with every long list replaced by a summary: numbers by {length, min, \
max, mean, std, argmin, argmax, first, last}, matrices by {shape, min, max, mean, std, argmin, argmax}, booleans by \
{length, true} and anything else by {length, head}. Then read one part with \`path\` (dotted, list indices as \
numbers, e.g. "data.0.values" or "y.rmsd.data"), optionally cut to \`range\` [start, end). Numeric and boolean \
lists and matrices come back downsampled to about \`maxPoints\` values, keeping every \`stride\`-th one (a \
[rows, columns] stride for matrices, where \`range\` picks rows); other lists come back item by item. Numbers are rounded to 6 significant digits.

Some analyses only list their parts, e.g. clusters gives [{"name": "Overall", "analysis": "clusters-00"}]: read \
each part by its analysis name.

Each analysis is stored as the workflow version that ran it wrote it, so the same analysis can be shaped \
differently in different projects. \`start\` and \`step\` usually give the frame of the first value and the frames \
between values (a few uploads have a wrong step); get_project has the MD's frame count and FRAMESTEP (ns per \
frame). Units as the MDDB web client shows them: RMSD, radius of gyration, fluctuation (RMSF) and distances in Å, \
SASA in Å², pocket volumes in Å³, energies in kcal/mol. APL is in nm in older uploads and in Å in newer ones.`,
    inputSchema: {
      accession: z.string().describe('e.g. A0001, MD-A00001, or A01YJ.2 for its second MD'),
      name: z.string().describe('Analysis name, e.g. rmsds or clusters-00'),
      path: z.string().optional().describe('Dotted path to one part, e.g. "data.0.values"'),
      range: z.array(z.number().int().min(0)).min(1).max(2).optional()
        .describe('[start, end) of the list at path; end defaults to its length'),
      maxPoints: z.number().int().min(1).max(2000).default(200),
    },
    annotations: READ_ONLY,
  }, async args => json(await getAnalysis(api, args)));

  server.registerTool('get_topology', {
    title: 'Describe the topology',
    description: `Describe what an MD system is made of, from its topology: every chain with its residue \
numbering, the one-letter sequence of its standard amino acids and nucleotides, how many of each other residue it \
has (ligands, lipids, ions, water...) and the references (UniProt ids, InChI keys) its residues map to. Topologies \
from newer workflows also give the atom count of each selection the workflow saved: residue classes such as \
protein, fatty or ion, and others such as pbc.

With \`residues\` or \`atoms\` it describes those instead: chain, residue name and number, plus the reference and \
position in it for residues, and name and element for atoms. Indices are 0-based positions in the topology, which \
is how analyses refer to residues (e.g. rmsd-perres rows, interaction residue_indices) and atoms (e.g. fluctuation \
values, hbonds acceptors).`,
    inputSchema: {
      accession: z.string().describe('e.g. A0001 or MD-A00001'),
      residues: z.array(z.number().int().min(0)).max(200).optional().describe('0-based residue indices'),
      atoms: z.array(z.number().int().min(0)).max(200).optional().describe('0-based atom indices'),
    },
    annotations: READ_ONLY,
  }, async args => json(await getTopology(api, args)));

  const referenceType = z.enum(REFERENCE_TYPES)
    .describe('proteins (UniProt ids), pdbs (PDB ids), inchikeys (ligands and lipids), chains (protein chain sequences) or collections');

  server.registerTool('get_references', {
    title: 'Get references',
    description: `Get the reference data behind a project, or one reference: UniProt proteins (name, gene, organism, \
sequence, domains, functions), PDB entries (title, method, organisms, chain UniProt ids), InChI keys for ligands \
and lipids (names, formula, PubChem, DrugBank, ChEMBL, LIPID MAPS and SwissLipids data), chain sequences with the \
InterPro entries found in them, and collections. Per-residue PDBe data, 2D structures, fingerprints and Mordred \
descriptors are left out. Each project reference has a ref_type. References are stored as each workflow version \
wrote them, so their fields vary.`,
    inputSchema: {
      accession: z.string().optional().describe('A project, e.g. MD-A00001, to get all its references'),
      type: referenceType.optional(),
      id: z.string().optional().describe('With type: a UniProt id, PDB id, InChI key, chain sequence or collection id'),
    },
    annotations: READ_ONLY,
  }, async args => json(await getReferences(api, args)));

  server.registerTool('find_simulations', {
    title: 'Find simulations of a reference',
    description: `Find every simulation that includes a protein, PDB entry, ligand, chain sequence or collection. \
From the global API this also lists simulations in other MD databases, such as MDRepo and ATLAS: \`sources\` counts \
them by website. Node APIs also say how much of each simulated system is that reference (presence, \
present_residues as 0-based residue indices) and, for proteins, which of its residues it covers (coverage, \
covered_residues as UniProt positions). To filter MDDB projects by other fields too, use search_projects with \
references.* or metadata.REFERENCES conditions instead.`,
    inputSchema: {
      type: referenceType,
      id: z.string().describe('A UniProt id, PDB id, InChI key, chain sequence or collection id'),
      limit: z.number().int().min(1).max(500).default(50),
      page: z.number().int().min(1).default(1),
    },
    annotations: READ_ONLY,
  }, async args => json(await findSimulations(api, args)));

  server.registerTool('get_download_url', {
    title: 'Get a download link',
    description: `Get a link to download an MD's structure, trajectory or one of its files, checked against the \
API without downloading anything. Returns the URL on the node that stores the data, so it needs no redirects, the \
file name, the content type and the size in bytes (not for trajectories, which are streamed). Give it to the user \
or to a program; this tool never returns the data itself.

- structure: PDB (default) or mmcif
- trajectory: bin (raw float32 coordinates, as the web client reads them; default), xtc, trr, nc (Amber NetCDF), \
dcd or mdcrd
- coordinates and box: raw float32 coordinates or box vectors, in newer API versions only
- file: one of the files get_project lists, by filename

Cut structures and trajectories with \`selection\` (NGL language, e.g. "protein and .CA" or ":A and 10-50") and/or \
0-based \`atoms\`, \`residues\` and \`chains\` (e.g. "0-9,12"), and trajectories with 1-based \`frames\` ("1-100", \
"1-3,10" or start:end:step as "1:1000:10"). \`numbering: uniprot\` makes the selection and the PDB residue numbers \
UniProt positions.

Nodes run different API versions, and older ones silently ignore what they don't support, so the link is refused \
when the served format is not the requested one or numbering is ignored, and \`warning\` says when the selection \
matched every atom, which is also what an unparseable selection gives.`,
    inputSchema: {
      accession: z.string().describe('e.g. A0001, MD-A00001, or A01YJ.2 for its second MD'),
      data: z.enum(DATA),
      filename: z.string().optional().describe('For data: file, e.g. trajectory.xtc'),
      format: z.enum(FORMATS).optional(),
      frames: z.string().optional().describe('1-based, e.g. "1-100" or "1:1000:10"'),
      selection: z.string().optional().describe('NGL selection, e.g. "protein and .CA"'),
      numbering: z.enum(NUMBERINGS).optional(),
      atoms: z.string().optional().describe('0-based atom indices or ranges, e.g. "0-9,12"'),
      residues: z.string().optional().describe('0-based residue indices or ranges'),
      chains: z.string().optional().describe('0-based chain indices or ranges'),
    },
    annotations: READ_ONLY,
  }, async args => json(await getDownloadUrl(probe, args)));

  return server;
};

module.exports = createServer;
