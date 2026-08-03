const express = require('express');
const router = express.Router();
const { isAccessAllowed } = require('../utils/shiftValidator');

let workspaces = [
  { id: 'ws-101', developer: 'Alex Rivera', role: 'Developer', shift: 'Day Shift', status: 'Running', idleMinutes: 5, cpu: '12%', ram: '420MB' },
  { id: 'ws-102', developer: 'Sarah Chen', role: 'Developer', shift: 'Night Shift', status: 'Sleeping', idleMinutes: 120, cpu: '0%', ram: '0MB' },
  { id: 'ws-103', developer: 'Marcus Vance', role: 'Manager', shift: 'Day Shift', status: 'Running', idleMinutes: 2, cpu: '45%', ram: '1.2GB' },
  { id: 'ws-104', developer: 'Elena Rostova', role: 'Developer', shift: 'Day Shift', status: 'Sleeping', idleMinutes: 45, cpu: '0%', ram: '0MB' }
];

// GET /api/workspaces
router.get('/', (req, res) => {
  res.json({ success: true, count: workspaces.length, data: workspaces });
});

// POST /api/workspaces/:id/wake
router.post('/:id/wake', (req, res) => {
  const ws = workspaces.find(w => w.id === req.params.id);
  if (!ws) {
    return res.status(404).json({ success: false, message: 'Workspace not found' });
  }

  ws.status = 'Running';
  ws.idleMinutes = 0;
  ws.cpu = '15%';
  ws.ram = '512MB';

  res.json({
    success: true,
    message: `Workspace ${ws.id} woken up successfully`,
    data: ws
  });
});

// POST /api/workspaces/:id/scale-to-zero
router.post('/:id/scale-to-zero', (req, res) => {
  const ws = workspaces.find(w => w.id === req.params.id);
  if (!ws) {
    return res.status(404).json({ success: false, message: 'Workspace not found' });
  }

  ws.status = 'Sleeping';
  ws.idleMinutes = 0;
  ws.cpu = '0%';
  ws.ram = '0MB';

  res.json({
    success: true,
    message: `Scaled workspace ${ws.id} to 0 replicas`,
    data: ws
  });
});

// IMPORTANT: Always export the router!
module.exports = router;