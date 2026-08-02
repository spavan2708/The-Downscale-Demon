require("dotenv").config();

const express = require("express");
const cors = require("cors");

const employeeRoutes = require("./routes/employeeRoutes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Root Route
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        project: "The Downscale Demon",
        company: "TechNova Solutions",
        version: "1.0",
        message: "Enterprise Scale-to-Zero Cloud Workspace Manager"
    });
});

// Employee API
app.use("/api/employees", employeeRoutes);

// Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log("=================================");
    console.log("🚀 Downscale Demon Backend Started");
    console.log(`🌐 Running on http://localhost:${PORT}`);
    console.log("📊 Employee API : /api/employees");
    console.log("=================================");
});