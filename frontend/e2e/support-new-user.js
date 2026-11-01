import { execFileSync } from "node:child_process";
import path from "node:path";

// Helpers for specs that sign up a brand-new account. They read the emailed code straight from the database that the
// backend under test uses (the real one, or a scratch schema when DATABASE_NAME is set) and delete the account afterwards.
const here = __dirname; // Playwright runs specs as CommonJS
const tests = path.resolve(here, "../../backend/tests");
const python = process.platform === "win32" ? path.resolve(here, "../../backend/.venv/Scripts/python.exe") : "python3";

const tool = (...args) => execFileSync(python, ["-X", "utf8", path.join(tests, "e2e_user_tool.py"), ...args],
  { cwd: tests, encoding: "utf8", env: { ...process.env, PYTHONPATH: tests } }).trim();

export const newEmail = () => `e2e_${Math.random().toString(16).slice(2, 10)}@example.com`;
export const verificationCode = (email) => tool("code", email);
export const deleteUser = (email) => { try { tool("delete", email); } catch { /* already gone */ } };
