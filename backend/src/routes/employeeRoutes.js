const express = require('express');
const router = express.Router();
const { isAccessAllowed } = require('../utils/shiftValidator');

// Mock employee database
let employees = [
  {
    id: 'emp-001',
    name: 'Alex Rivera',
    role: 'Developer',
    shift: 'Day Shift',
    workspace: 'ws-101',
    overtime: false
  },
  {
    id: 'emp-002',
    name: 'Sarah Chen',
    role: 'Developer',
    shift: 'Night Shift',
    workspace: 'ws-102',
    overtime: false
  },
  {
    id: 'emp-003',
    name: 'Marcus Vance',
    role: 'Manager',
    shift: 'Day Shift',
    workspace: 'ws-103',
    overtime: true
  },
  {
    id: 'emp-004',
    name: 'Elena Rostova',
    role: 'Developer',
    shift: 'Day Shift',
    workspace: 'ws-104',
    overtime: false
  }
];

// GET /api/employees - Return all employees with dynamically evaluated shift access
router.get('/', (req, res) => {
  try {
    const processedEmployees = employees.map((emp) => {
      // Evaluate shift access using the shiftValidator utility
      const accessResult = isAccessAllowed(emp.shift, emp.overtime, emp.role);
      
      return {
        ...emp,
        access: accessResult.allowed ? 'ALLOWED' : 'DENIED',
        accessReason: accessResult.reason
      };
    });

    res.json(processedEmployees);
  } catch (error) {
    console.error('Error processing employees:', error);
    res.status(500).json({ success: false, message: 'Server error processing employee access' });
  }
});

// POST /api/employees/:id/overtime - Toggle overtime access for an employee
router.post('/:id/overtime', (req, res) => {
  const { id } = req.params;
  const { overtime } = req.body;

  const employee = employees.find((e) => e.id === id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  employee.overtime = typeof overtime === 'boolean' ? overtime : !employee.overtime;

  res.json({
    success: true,
    message: `Overtime status updated for ${employee.name}`,
    data: employee
  });
});

// IMPORTANT: Always export the router so server.js can mount it!
module.exports = router;