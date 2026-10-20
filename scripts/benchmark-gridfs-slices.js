// Benchmark: reading parts of GridFS trajectories with the current ranged stream vs slicing chunks on the MongoDB server
//
// The current reader (src/utils/get-ranged-stream) downloads whole GridFS chunks (4 MB with the loader) even when it needs a
// few bytes of them. MongoDB 8.0+ can convert a chunk to base64 and cut substrings out of it, so only the requested bytes
// travel. This script compares both readers on the reads the client really does and checks they return the same bytes.
//
// Run it from the API root, where the .env with the database connection is:
//   node scripts/benchmark-gridfs-slices.js [--runs 3] [--host localhost:8000] [--match TEXT] [ACCESSION ...]
// Default accessions: A0001 A05PJ. --host is the host the API config is looked up with (as in request.get('host')).
// --match runs only the reads whose name contains TEXT (e.g. --match structure to skip the slow trajectory reads).
//
// It only reads from the database.
// "Read from Mongo" is the growth of this process's read bytes (/proc/self/io rchar), which is mostly the database socket.

require('dotenv').config();
const fs = require('fs');
const getDatabase = require('../src/database');
const getRangedStream = require('../src/utils/get-ranged-stream');
const consumeStream = require('../src/utils/consume-stream');

// Parse command line arguments
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args.splice(index, 2)[1];
};
const RUNS = Number(option('--runs', 3));
const HOST = option('--host', 'localhost:8000');
const MATCH = option('--match', '');
const ACCESSIONS = args.length ? args : ['A0001', 'A05PJ'];

// Bytes read by this process so far, or null when /proc is not available
const readBytes = () => {
  try { return Number(/rchar: (\d+)/.exec(fs.readFileSync('/proc/self/io', 'utf8'))[1]); }
  catch { return null; }
};

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Current reader: ranges are [{ start, end }] with an inclusive end, as the API uses them
const readWithStream = (bucket, file, ranges) =>
  consumeStream(getRangedStream(bucket, file._id, ranges.map(({ start, end }) => ({ start, end: end - 1 }))));

// Sliced reader: ranges are [{ start, end }] with an exclusive end
// Base64 encodes 3 bytes in 4 characters, so every piece is widened to multiples of 3 bytes and trimmed after decoding
const readWithSlices = async (chunks, file, ranges) => {
  const size = file.chunkSize;
  const pieces = [];
  for (const { start, end } of ranges) {
    for (let position = start; position < end;) {
      const n = Math.floor(position / size);
      const pieceEnd = Math.min(end, (n + 1) * size);
      const from = position - n * size;
      const to = pieceEnd - n * size;
      const alignedFrom = from - (from % 3);
      const alignedTo = Math.min(Math.ceil(to / 3) * 3, size);
      pieces.push({
        n,
        chars: { from: (alignedFrom / 3) * 4, length: Math.ceil((alignedTo - alignedFrom) / 3) * 4 },
        trim: from - alignedFrom,
        length: to - from,
      });
      position = pieceEnd;
    }
  }
  const documents = await chunks.aggregate([
    { $match: { files_id: file._id, n: { $in: [...new Set(pieces.map(piece => piece.n))] } } },
    { $project: { _id: 0, n: 1, base64: { $convert: { input: '$data', to: 'string', format: 'base64' } } } },
    { $project: { n: 1, slices: { $map: {
      input: { $filter: {
        input: pieces.map(({ n, chars }) => ({ n, from: chars.from, length: chars.length })),
        cond: { $eq: ['$$this.n', '$n'] },
      } },
      // Base64 is ASCII, so bytes are characters. $substrCP would count characters from the start on every piece
      in: { $substrBytes: ['$base64', '$$this.from', '$$this.length'] },
    } } } },
  ], { allowDiskUse: true }).toArray();
  // Pieces of the same chunk come back in the same order they were requested
  const slicesByChunk = new Map(documents.map(document => [document.n, document.slices]));
  const usedByChunk = new Map();
  return Buffer.concat(pieces.map(piece => {
    const used = usedByChunk.get(piece.n) || 0;
    usedByChunk.set(piece.n, used + 1);
    const bytes = Buffer.from(slicesByChunk.get(piece.n)[used], 'base64');
    return bytes.subarray(piece.trim, piece.trim + piece.length);
  }));
};

// Consecutive byte ranges are merged so a contiguous read is a single range
const mergeRanges = ranges => ranges.reduce((merged, range) => {
  const last = merged[merged.length - 1];
  if (last && last.end === range.start) last.end = range.end;
  else merged.push({ ...range });
  return merged;
}, []);

// The reads the client does, as byte ranges of the trajectory file
const getCases = (file, referenceFrame) => {
  const atoms = file.metadata.atoms;
  const frames = file.metadata.frames;
  const frameBytes = atoms * 12;
  const frameStart = referenceFrame * frameBytes;
  // Same step as the viewer's default request of 50 frames (getFrames in the client's use-viewer-data)
  const step = Math.max(Math.floor(frames / 50), 1);
  const stridedFrames = [];
  for (let frame = 0; frame < frames; frame += step) stridedFrames.push(frame);
  // A sparse selection of ~8000 atoms spread over the whole system, like the reduced membrane view
  const atomStep = Math.max(Math.floor(atoms / 8000), 1);
  const sparseAtoms = [];
  for (let atom = 0; atom < atoms; atom += atomStep) sparseAtoms.push(atom);
  const cases = [
    {
      name: 'structure: reference frame, all atoms',
      ranges: [{ start: frameStart, end: frameStart + frameBytes }],
    },
    {
      name: `trajectory: ${stridedFrames.length} frames, step ${step} (viewer default)`,
      ranges: stridedFrames.map(frame => ({ start: frame * frameBytes, end: (frame + 1) * frameBytes })),
    },
  ];
  // Small systems have no sparse selection: it would be all atoms
  if (atomStep > 1) cases.splice(1, 0, {
    name: `structure: reference frame, ${sparseAtoms.length} sparse atoms`,
    ranges: mergeRanges(sparseAtoms.map(atom => ({ start: frameStart + atom * 12, end: frameStart + (atom + 1) * 12 }))),
  });
  return cases.filter(testCase => testCase.name.includes(MATCH));
};

// Time a reader and measure how many bytes this process read meanwhile
const measure = async read => {
  const bytesBefore = readBytes();
  const start = process.hrtime.bigint();
  const result = await read();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const bytesAfter = readBytes();
  return { result, ms, mongoBytes: bytesBefore === null ? null : bytesAfter - bytesBefore };
};

const megabytes = bytes => (bytes === null ? '?' : (bytes / 1e6).toFixed(bytes < 1e6 ? 3 : 1));

const main = async () => {
  const request = { params: {}, body: {}, query: {}, get: () => HOST };
  let database = await getDatabase(request);
  const mongo = database.bucket.s.db;
  const { version } = await mongo.admin().command({ buildInfo: 1 });
  const canSlice = Number(version.split('.')[0]) >= 8;
  console.log(`MongoDB ${version}. Server-side slices ${canSlice ? 'available' : 'NOT available (needs MongoDB 8.0+)'}.`);
  console.log(`Host config: ${HOST}. Runs per reader: ${RUNS}. Times and bytes are medians.\n`);
  const chunks = mongo.collection('fs.chunks');
  const rows = [];
  for (const accession of ACCESSIONS) {
    request.params.project = accession;
    database = await getDatabase(request);
    const project = await database.getProject();
    if (project.error) {
      console.log(`${accession}: ${project.error}`);
      continue;
    }
    const file = await project.getTrajectorFileDescriptor();
    if (file.error) {
      console.log(`${accession}: ${file.error}`);
      continue;
    }
    console.log(`${accession}: ${file.metadata.atoms} atoms, ${file.metadata.frames} frames, ` +
      `${megabytes(file.metadata.atoms * 12)} MB per frame, GridFS chunks of ${megabytes(file.chunkSize)} MB`);
    for (const testCase of getCases(file, project.referenceFrame)) {
      const requested = testCase.ranges.reduce((total, { start, end }) => total + end - start, 0);
      const readers = { stream: () => readWithStream(database.bucket, file, testCase.ranges) };
      if (canSlice) readers.slices = () => readWithSlices(chunks, file, testCase.ranges);
      const runs = { stream: [], slices: [] };
      let identical = null;
      // Alternate the readers so changes in network or database load affect both alike
      // Only the first run of each reader keeps its bytes, until they are compared, since reads may be hundreds of MB
      for (let run = 0; run < RUNS; run++) {
        const firstResults = {};
        for (const [reader, read] of Object.entries(readers)) {
          const { result, ...measured } = await measure(read);
          if (result.length !== requested) throw new Error(`${reader} returned ${result.length} bytes, expected ${requested}`);
          if (run === 0) firstResults[reader] = result;
          runs[reader].push(measured);
        }
        if (canSlice && run === 0) identical = firstResults.stream.equals(firstResults.slices);
      }
      for (const [reader, measures] of Object.entries(runs)) {
        if (!measures.length) continue;
        const bytes = measures.map(measured => measured.mongoBytes);
        rows.push({
          accession,
          read: testCase.name,
          reader,
          'requested MB': megabytes(requested),
          'read from Mongo MB': megabytes(bytes.includes(null) ? null : median(bytes)),
          'time ms': Math.round(median(measures.map(measured => measured.ms))),
          'same bytes': identical === null ? '-' : identical ? 'yes' : 'NO',
        });
      }
    }
  }
  console.log();
  console.table(rows);
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
