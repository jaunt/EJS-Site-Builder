#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const fs_1 = __importDefault(require("fs"));
const chalk_1 = __importDefault(require("chalk"));
const process_1 = require("process");
const { spawn } = require("child_process");
const version = "0.0.1"; // todo get version from git tag
const BAD_OPTIONS = 3;
console.log(chalk_1.default.black.bgWhite.bold("\n Air", chalk_1.default.white.bgBlue(" Fry ", chalk_1.default.green.bgWhite("TESTER\n"))));
console.log(chalk_1.default.blueBright("Version " + version + "\n"));
const program = new commander_1.Command().option("-i, --input <testName>", "test name");
program.version(version);
program.parse(process.argv);
const options = program.opts();
console.log(options);
const testName = options.input;
const testDir = process.cwd() + "/tests/" + testName + "/";
let rawdata = fs_1.default.readFileSync(testDir + "config.json");
let config = JSON.parse(rawdata.toString());
if (!config) {
    console.error("Test " + testName + " missing config.json");
    (0, process_1.exit)(3);
}
const cmd = process.cwd() + "/lib/cli.js";
const cwd = process.cwd() + "/tests/" + testName;
const airfry = spawn("node", [cmd, ...config.args], {
    stdio: ["ignore", process.stdout, "pipe"],
    shell: true,
    cwd: cwd,
});
let timeout;
if (config.timeout) {
    const timeout = setTimeout(() => {
        airfry.kill("SIGINT");
    }, config.timeout);
}
airfry.stderr.on("data", (data) => {
    console.error(chalk_1.default.red.bold(`${data}`));
});
airfry.on("close", (code, signal) => {
    if (signal) {
        console.log(`child process terminated due to receipt of signal ${signal}`);
    }
});
airfry.on("exit", (code) => {
    if (code) {
        console.log(`child process exited with code ${code}`);
    }
    if (timeout)
        clearTimeout(timeout);
});
//# sourceMappingURL=tester.js.map