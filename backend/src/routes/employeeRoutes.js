const express = require("express");
const router = express.Router();

const checkAccess = require("../utils/shiftValidator");

const employees = [

    {
        id: 1,
        name: "Ravi Kumar",
        role: "Developer",
        shift: "Day Shift",
        workspace: "Feature-Login",
        overtime: false
    },

    {
        id: 2,
        name: "Priya Sharma",
        role: "Developer",
        shift: "Night Shift",
        workspace: "Feature-Payment",
        overtime: false
    },

    {
        id: 3,
        name: "Arjun",
        role: "Manager",
        shift: "Flexible",
        workspace: "Management",
        overtime: true
    }

];

router.get("/", (req, res) => {

    const updated = employees.map(emp => ({

        ...emp,

        access: checkAccess(emp)

    }));

    res.json(updated);

});

module.exports = router;