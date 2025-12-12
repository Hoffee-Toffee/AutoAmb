import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Root route for status check
app.get('/', (req, res) => {
  res.send('AutoAmb API server is running.');
});

// Allow CORS for all origins (for development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
const PORT = 3001;
const OUT_DIR = path.join(__dirname, 'out');
const OUTPUT_FILE = path.join(OUT_DIR, 'output.mp3');

app.use(express.json());
app.use('/out', express.static(OUT_DIR));

// Run the main soundscape generation
app.post('/api/generate', async (req, res) => {
  const args = req.body && req.body.planOnly ? ['--plan-only'] : [];
  const proc = spawn('node', [path.join(__dirname, 'src/index.js'), ...args]);
  let logs = '';
  proc.stdout.on('data', (data) => {
    logs += data.toString();
  });
  proc.stderr.on('data', (data) => {
    logs += data.toString();
  });
  proc.on('close', async (code) => {
    const fileExists = await fs
      .access(OUTPUT_FILE)
      .then(() => true)
      .catch(() => false);
    res.json({
      success: code === 0 && fileExists,
      logs,
      file: fileExists ? `/out/output.mp3` : null,
    });
  });
});

// Get logs (timeline/intensity)
app.get('/api/logs', async (req, res) => {
  try {
    const timeline = await fs.readFile(path.join(OUT_DIR, 'timeline_log.json'), 'utf8');
    const intensity = await fs.readFile(path.join(OUT_DIR, 'intensity_log.json'), 'utf8');
    res.json({ timeline: JSON.parse(timeline), intensity: JSON.parse(intensity) });
  } catch (e) {
    res.status(404).json({ error: 'Logs not found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AutoAmb API server running on http://0.0.0.0:${PORT}`);
});
