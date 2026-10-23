const { copyFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

// Keep the recorder local, including packaged/offline runs. Preserve its license header.
const directory = path.dirname(require.resolve('@rrweb/record'));
mkdirSync('dist-electron', { recursive: true });
copyFileSync(path.join(directory, 'record.umd.min.cjs'), 'dist-electron/live-session-recorder.js');
const replayDirectory = path.dirname(require.resolve('@rrweb/replay'));
copyFileSync(path.join(replayDirectory, 'replay.umd.min.cjs'), 'dist-electron/live-session-replayer.js');
copyFileSync(path.join(replayDirectory, 'style.css'), 'dist-electron/live-session-replayer.css');
