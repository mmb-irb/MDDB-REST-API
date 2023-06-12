// Set the configuration of some elements when the .env is too limited
// i.e. anything which is not a plain string
module.exports = {
  hosts: {
    'localhost:8000': {
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
  },
};
