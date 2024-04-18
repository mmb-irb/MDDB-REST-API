// Set the configuration of some elements when the .env is too limited
// i.e. anything which is not a plain string
module.exports = {
  hosts: {
    'localhost': {
      name: 'MDposit (local)',
      description: 'The main server including all simulations',
      prefix: 'MDP',
      collection: null,
    },
    'mdposit.mddbr.eu': {
      name: 'MDposit',
      description: 'The main server including all simulations',
      prefix: 'MD',
      collection: null,
    },
    'mdposit-dev.mddbr.eu': {
      name: 'MDposit',
      description: 'The main server including all simulations',
      prefix: 'MD',
      collection: null,
    },
    'mdposit-dev.bsc.es': {
      name: 'MDposit',
      description: 'The main server including all simulations',
      prefix: 'MDP',
      collection: null,
    },
    'bioexcel-cv19.bsc.es': {
      name: 'BioExcel-CV19',
      description: 'The Covid-19 server',
      prefix: 'MCV19',
      collection: 'cv19',
    },
    'bioexcel-cv19-dev.bsc.es': {
      name: 'BioExcel-CV19',
      description: 'The Covid-19 server',
      prefix: 'MCV19',
      collection: 'cv19',
    },
    'model-cns-dev.bsc.es': {
      name: 'MoDEL-CNS',
      description: 'The Central Nervous System server',
      prefix: 'MCNS',
      collection: 'mcns',
    },
    'abc-dev.mddbr.eu': {
      name: 'ABC',
      description: 'The ABC server',
      prefix: 'ABCMD',
      collection: 'abc', // This could be null with the current implementation
    },
    'abc.mddbr.eu': {
      name: 'ABC',
      description: 'The ABC server',
      prefix: 'ABCMD',
      collection: 'abc', // This could be null with the current implementation
    },
    'mmb-dev.mddbr.eu': {
      name: 'MMB node',
      description: 'The MMB federated node server',
      prefix: 'MCV19',
      collection: null,
    },
    'mmb.mddbr.eu': {
      name: 'MMB node',
      description: 'The MMB federated node server',
      prefix: 'MCV19',
      collection: null,
    },
  },
};
