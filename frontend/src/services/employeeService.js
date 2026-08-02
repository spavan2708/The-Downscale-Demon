const API_URL = "http://localhost:5000/api/employees";

export async function getEmployees() {
  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error("Failed to fetch employees");
  }

  return await response.json();
}