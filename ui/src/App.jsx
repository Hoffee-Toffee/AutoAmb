

import { useState } from 'react';
import './App.css';

const API_URL = (() => {
  // Use window.location.hostname, but always use http and port 3001
  let host = window.location.hostname;
  // If running on localhost, use 127.0.0.1 for consistency
  if (host === 'localhost') host = '127.0.0.1';
  return `http://${host}:3001`;
})();


function App() {
  const [log, setLog] = useState('');
  const [mediaUrl, setMediaUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [planOnly, setPlanOnly] = useState(false);

  // Call backend to generate the real file or just the plan
  const handleGenerate = async (isSchedule) => {
    setGenerating(true);
    setLog(isSchedule
      ? `Testing whole schedule${planOnly ? ' (plan only)' : ''}...\n`
      : `Generating test chunk${planOnly ? ' (plan only)' : ''}...\n`
    );
    setMediaUrl(null);
    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planOnly }),
      });
      const data = await res.json();
      setLog(data.logs || 'No logs');
      if (!planOnly && data.success && data.file) {
        setMediaUrl(`${API_URL}${data.file}`);
      } else {
        setMediaUrl(null);
      }
    } catch (e) {
      setLog('Error: ' + e.message);
      setMediaUrl(null);
    }
    setGenerating(false);
  };

  return (
    <div style={{ maxWidth: 500, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h2>AutoAmb Test UI</h2>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 14 }}>
          <input
            type="checkbox"
            checked={planOnly}
            onChange={e => setPlanOnly(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          Plan Only (no audio generation)
        </label>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button onClick={() => handleGenerate(true)} disabled={generating}>
          Test Whole Schedule
        </button>
        <button onClick={() => handleGenerate(false)} disabled={generating}>
          {planOnly ? 'Plan Test Chunk' : 'Generate Test Chunk'}
        </button>
      </div>
      <div style={{ background: '#222', color: '#eee', padding: 12, minHeight: 80, borderRadius: 6, fontFamily: 'monospace', marginBottom: 16 }}>
        <strong>Logs:</strong>
        <pre style={{ margin: 0 }}>{log}</pre>
      </div>
      {mediaUrl && !generating && (
        <div style={{ marginTop: 16 }}>
          <audio controls src={mediaUrl} style={{ width: '100%' }} />
        </div>
      )}
      <div style={{ marginTop: 32, color: '#888', fontSize: 13 }}>
        <span>API server: <code>{API_URL}</code></span>
      </div>
    </div>
  );
}

export default App
