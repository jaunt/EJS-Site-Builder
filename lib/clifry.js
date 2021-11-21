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
const shared_1 = require("./shared");
var emitter = require("events").EventEmitter;
const version = "0.0.1"; // todo get version from git tag
console.log(chalk_1.default.black.bgWhite.bold("\n CLI", chalk_1.default.white.bgBlue(" FRY ")));
console.log(chalk_1.default.blueBright("Version " + version + "\n"));
const _formatLog = (useChalk = chalk_1.default.green, ...args) => {
    for (let arg of args) {
        let txt;
        if (typeof arg === "string" || arg instanceof String) {
            txt = arg;
        }
        else {
            txt = JSON.stringify(arg, null, 2);
        }
        console.log(useChalk("> " + chalk_1.default.bgWhite(arg)));
    }
};
const log = _formatLog.bind(null, chalk_1.default.green);
const logError = _formatLog.bind(null, chalk_1.default.red);
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
        logError("Error finding tests.", error);
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
const clearTimers = (state) => {
    if (state.timeout) {
        clearTimeout(state.timeout);
        state.timeout = null;
    }
    if (state.pinger != null) {
        state.pinger.done();
    }
};
const cleanupTest = (state) => {
    clearTimers(state);
    if (state.process && state.process.exitCode == null) {
        // remove all listeners and exit
        state.process.removeAllListeners("exit");
        state.process.removeAllListeners("close");
        state.process.removeAllListeners("sstate.processawn");
        state.process.removeAllListeners("data");
        state.process.kill("SIGINT");
        log("Force quitting CLI on cleanup");
    }
};
const runTest = (testName) => {
    return new Promise(async function (resolve, reject) {
        const testDir = path_1.default.resolve(options.folder + "/" + testName);
        let testModule = path_1.default.resolve(testDir + "/" + "test.js");
        const cmd = path_1.default.resolve(options.cli);
        const cwd = path_1.default.resolve(options.folder + "/" + testName);
        let testState;
        try {
            const imported = await Promise.resolve().then(() => __importStar(require(testModule)));
            const test = imported.default;
            const result = await test((attr, args) => {
                log("Test: " + attr.name);
                log("Description: " + attr.description);
                const state = {
                    process: null,
                    errors: [],
                    output: [],
                    pinger: null,
                    secondsIdle: 0,
                    idleEmitter: null,
                    findIndex: {},
                    name: attr.name || "",
                    description: attr.name || "",
                    timeoutTime: attr.timeout,
                    timeout: null,
                    result: null,
                };
                testState = state;
                return {
                    dir: cwd,
                    start: () => {
                        if (state.process && state.process.exitCode == null) {
                            logError("CLI Already started.  Use forceStop or wait until the process ends.");
                            return;
                        }
                        state.process = spawn("node", [cmd, ...args], {
                            stdio: ["pipe", "pipe", "pipe"],
                            shell: true,
                            cwd: cwd,
                        });
                        state.process.on("spawn", () => {
                            log("CLI Started");
                            state.idleEmitter = new emitter();
                            state.pinger = new shared_1.Pinger("idleTimer", (id) => {
                                state.secondsIdle++;
                                state.idleEmitter.emit("tick", state.secondsIdle);
                            }, 1000);
                            state.timeout = state.timeoutTime
                                ? setTimeout(() => {
                                    log("CLI Run timeout expired. Force quitting.");
                                    state.process.kill("SIGINT");
                                    state.timeout = null;
                                }, attr.timeout)
                                : null;
                        });
                        state.process.stdout.on("data", (data) => {
                            state.output.push(data.toString());
                            state.secondsIdle = 0;
                        });
                        state.process.stderr.on("data", (data) => {
                            state.errors.push(data.toString());
                            state.secondsIdle = 0;
                        });
                        state.process.on("close", (code, signal) => {
                            if (code) {
                                log(`child process closed with code ${code}`);
                            }
                            if (signal) {
                                log(`child process terminated due to receipt of signal ${signal}`);
                            }
                        });
                        state.process.on("exit", (code) => {
                            clearTimers(state);
                            if (code) {
                                log(`child process exited with code ${code}`);
                            }
                        });
                    },
                    stopped: () => {
                        return new Promise(function (resolve) {
                            if (!state.process) {
                                logError("CLI has not started.");
                                resolve(0);
                            }
                            else if (state.process.exitCode != null) {
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
                        if (state.process && state.process.exitCode == null) {
                            log("Passing SIGINT to process");
                            state.process.kill("SIGINT");
                        }
                        else {
                            logError("CLI not running, nothing to force stop");
                        }
                    },
                    log: (message) => {
                        log("(" + state.name + ") " + message);
                    },
                    error: (message) => {
                        logError("(" + state.name + ") " + message);
                    },
                    sleep: (ms) => {
                        return new Promise((resolve) => setTimeout(resolve, ms));
                    },
                    waitUntilOutputIdleSeconds: (seconds) => {
                        // wait number of seconds since last stdout or stderr
                        return new Promise(function (resolve) {
                            if (!state.process) {
                                logError("Test has not started, nothing to wait for.");
                                resolve(0);
                                return;
                            }
                            if (state.secondsIdle >= seconds) {
                                resolve(state.secondsIdle);
                            }
                            else {
                                state.idleEmitter.on("tick", function (seconds) {
                                    if (state.secondsIdle >= seconds) {
                                        resolve(state.secondsIdle);
                                    }
                                });
                            }
                        });
                    },
                    untilOutputIncludes: (search) => {
                        // optimized so that we don't keep checking the entire
                        // recorded output every time.  Can be called multiple times before
                        // or after a search string is found.  to find the next time the
                        // search occurs
                        const _outIncludes = (search) => {
                            if (!state.findIndex[search]) {
                                state.findIndex[search] = 0;
                            }
                            if (state.findIndex[search] == state.output.length)
                                return false;
                            const index = state.output
                                .slice(state.findIndex[search])
                                .findIndex((value) => value.includes(search));
                            state.findIndex[search] =
                                index == -1
                                    ? state.output.length
                                    : index + state.findIndex[search] + 1;
                            return index != -1;
                        };
                        return new Promise(function (resolve) {
                            if (!state.process) {
                                logError("Test has not started, no output to monitor.");
                                resolve(0);
                                return;
                            }
                            if (_outIncludes(search)) {
                                resolve(search);
                            }
                            else {
                                state.process.stdout.on("data", (data) => {
                                    if (_outIncludes(search)) {
                                        resolve(search);
                                    }
                                });
                            }
                        });
                    },
                };
            });
            testState.result = result;
            resolve(testState);
        }
        catch (error) {
            testState.result = error;
            reject(testState);
        }
    });
};
tests.forEach((testName) => {
    runTest(testName)
        .then((testState) => {
        cleanupTest(testState);
        log("Test Succeeded");
    })
        .catch((testState) => {
        cleanupTest(testState);
        logError("Test Failed");
    });
});
//# sourceMappingURL=clifry.js.map