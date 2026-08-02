function checkAccess(employee) {

    const now = new Date();

    const hour = now.getHours();

    // Manager always has access
    if (employee.role === "Manager") {
        return true;
    }

    // Overtime approved
    if (employee.overtime === true) {
        return true;
    }

    // Day Shift (09:00 - 18:00)
    if (employee.shift === "Day Shift") {
        return hour >= 9 && hour < 18;
    }

    // Night Shift (22:00 - 05:00)
    if (employee.shift === "Night Shift") {
        return hour >= 22 || hour < 5;
    }

    return false;
}

module.exports = checkAccess;