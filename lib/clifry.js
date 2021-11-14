#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const { spawn } = require("child_process");
const version = "0.0.1"; // todo get version from git tag
console.log(chalk_1.default.black.bgWhite.bold("\n CLI", chalk_1.default.white.bgBlue(" FRY ")));
console.log(chalk_1.default.blueBright("Version " + version + "\n"));
const program = new commander_1.Command()
    .option("-t, --tests [tests...]", "Test name or names.")
    .option("-a, --all", "run all tests")
    .option("-f, --folder <folder>", "tests parent folder (default = ./tests)", "./tests")
    .option("-c, --cli <path>", "path to cli to test (default = ./lib/cli.js)", "./lib/cli.js");
program.version(version);
program.parse(process.argv);
const options = program.opts();
const findAllTests = function (dirPath) {
    // tests are any folders under the test directory
    const found = [];
    try {
        const files = fs_1.default.readdirSync(dirPath);
        files.forEach(function (file) {
            if (fs_1.default.statSync(dirPath + "/" + file).isDirectory()) {
                found.push(file);
            }
        });
    }
    catch (error) {
        console.error(chalk_1.default.red("Error finding tests."));
        console.error(error);
    }
    return found;
};
let tests;
if (options.all) {
    tests = findAllTests(options.folder);
}
else {
    tests = options.tests;
}
const runTest = (testName) => {
    return new Promise(async function (resolve, reject) {
        const spawned = [];
        const testDir = path_1.default.resolve(options.folder + "/" + testName);
        let testModule = path_1.default.resolve(testDir + "/" + "test.js");
        const cmd = path_1.default.resolve(options.cli);
        const cwd = path_1.default.resolve(options.folder + "/" + testName);
        try {
            const imported = await Promise.resolve().then(() => __importStar(require(testModule)));
            const test = imported.default;
            await test((attr, args) => {
                const state = {
                    process: spawn("node", [cmd, ...args], {
                        stdio: ["ignore", process.stdout, "pipe"],
                        shell: true,
                        cwd: cwd,
                    }),
                    errors: [],
                    name: attr.name || "",
                    description: attr.name || "",
                    timeout: attr.timeout
                        ? setTimeout(() => {
                            console.log("Test timeout expired. Force quitting CLI.");
                            state.process.kill("SIGINT");
                            state.timeout = null;
                        }, attr.timeout)
                        : null,
                };
                console.log("Test Run Started: " + attr.name);
                console.log("Description: " + attr.description);
                spawned.push(state.process); // keep track of all spawned processes
                state.process.on("spawn", () => {
                    console.log("> " + "Spawned");
                });
                state.process.stderr.on("data", (data) => {
                    state.errors.push(data.toString());
                    console.log("> " + data.toString());
                });
                state.process.on("close", (code, signal) => {
                    if (state.timeout) {
                        clearTimeout(state.timeout);
                        state.timeout = null;
                    }
                    if (code) {
                        console.log("> " + `child process closed with code ${code}`);
                    }
                    if (signal) {
                        console.log("> " +
                            `child process terminated due to receipt of signal ${signal}`);
                    }
                });
                state.process.on("exit", (code) => {
                    if (state.timeout) {
                        clearTimeout(state.timeout);
                        state.timeout = null;
                    }
                    if (code) {
                        console.log("> " + `child process exited with code ${code}`);
                    }
                });
                return {
                    dir: cwd,
                    stopped: () => {
                        return new Promise(function (resolve) {
                            if (state.process.exitCode != null) {
                                resolve(state.process.exitCode);
                            }
                            else {
                                state.process.on("exit", () => {
                                    resolve(state.process.exitCode);
                                });
                            }
                        });
                    },
                    forceStop: () => {
                        state.process.kill("SIGINT");
                    },
                    log: (message) => {
                        console.log(chalk_1.default.blue("[" + state.name + "] ") + message);
                    },
                    error: (message) => {
                        console.error(chalk_1.default.blue("[" + state.name + "] ") + message);
                    },
                    writeFile: (file, data) => {
                        fs_1.default.writeFileSync(file, data);
                    },
                };
            });
            resolve("success");
        }
        catch (error) {
            reject(error);
        }
        finally {
            spawned.forEach((p) => {
                if (p.exitCode == null) {
                    // remove all listeners and exit
                    p.removeAllListeners("exit");
                    p.removeAllListeners("close");
                    p.removeAllListeners("spawn");
                    p.removeAllListeners("data");
                    p.kill("SIGINT");
                }
            });
        }
    });
};
tests.forEach((testName) => {
    runTest(testName)
        .then(() => {
        console.log(chalk_1.default.green.bold("> Test Run Succeeded."));
    })
        .catch((error) => {
        console.error(chalk_1.default.red.bold("> Test Run Failed: "));
        console.error(chalk_1.default.red.bold(error));
    });
});
//# sourceMappingURL=clifry.js.map