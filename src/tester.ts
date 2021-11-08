#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import fspath from "path";
import chalk from "chalk";
import { exit } from "process";
const { spawn } = require("child_process");

const version = "0.0.1"; // todo get version from git tag

const BAD_OPTIONS = 3;

console.log(
  chalk.black.bgWhite.bold(
    "\n Air",
    chalk.white.bgBlue(" Fry ", chalk.green.bgWhite("TESTER\n"))
  )
);
console.log(chalk.blueBright("Version " + version + "\n"));
const program = new Command().option("-i, --input <testName>", "test name");

program.version(version);
program.parse(process.argv);
const options = program.opts();

console.log(options);

const testName = options.input;

const testDir = process.cwd() + "/tests/" + testName + "/";

let rawdata = fs.readFileSync(testDir + "config.json");
let config = JSON.parse(rawdata.toString());

if (!config) {
  console.error("Test " + testName + " missing config.json");
  exit(3);
}

const cmd = process.cwd() + "/lib/cli.js";

const cwd = process.cwd() + "/tests/" + testName;

const airfry = spawn("node", [cmd, ...config.args], {
  stdio: ["ignore", process.stdout, "pipe"],
  shell: true,
  cwd: cwd,
});

let timeout: NodeJS.Timeout;

if (config.timeout as number) {
  const timeout = setTimeout(() => {
    airfry.kill("SIGINT");
  }, config.timeout);
}

airfry.stderr.on("data", (data: string) => {
  console.error(chalk.red.bold(`${data}`));
});

airfry.on("close", (code: number, signal: string) => {
  if (signal) {
    console.log(`child process terminated due to receipt of signal ${signal}`);
  }
});

airfry.on("exit", (code: number) => {
  if (code) {
    console.log(`child process exited with code ${code}`);
  }
  if (timeout) clearTimeout(timeout);
});
