const employees = [
  {
    id: 1,
    name: "Ravi Kumar",
    role: "Employee",
    shift: "Day",
    shiftStart: "09:00",
    shiftEnd: "18:00",
    access: true,
    workspace: "Running"
  },
  {
    id: 2,
    name: "Priya Sharma",
    role: "Employee",
    shift: "Night",
    shiftStart: "22:00",
    shiftEnd: "05:00",
    access: false,
    workspace: "Sleeping"
  },
  {
    id: 3,
    name: "Arjun",
    role: "Manager",
    shift: "Flexible",
    shiftStart: "--",
    shiftEnd: "--",
    overtime: true,
    access: true,
    workspace: "Running"
  }
];

module.exports = employees;