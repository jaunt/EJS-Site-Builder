#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import fspath from "path";
const { spawn } = require("child_process");

import { Pinger } from "./shared";

var emitter = require("events").EventEmitter;

const version = "0.0.1"; // todo get version from git tag

console.log(chalk.black.bgWhite.bold("\n CLI", chalk.white.bgBlue(" FRY ")));
console.log(chalk.blueBright("Version " + version + "\n"));
const program = new Command()
  .option("-t, --tests [tests...]", "Test name or names.")
  .option("-a, --all", "run all tests")
  .option(
    "-f, --folder <folder>",
    "tests parent folder (default = ./tests)",
    "./tests"
  )
  .option(
    "-c, --cli <path>",
    "path to cli to test (default = ./lib/cli.js)",
    "./lib/cli.js"
  );

program.version(version);
program.parse(process.argv);
const options = program.opts();

const findAllTests = function (dirPath: string): string[] {
  // tests are any folders under the test directory
  const found: string[] = [];
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(function (file) {
      if (fs.statSync(dirPath + "/" + file).isDirectory()) {
        found.push(file);
      }
    });
  } catch (error) {
    console.error(chalk.red("Error finding tests."));
    console.error(error);
  }
  return found;
};

let tests: string[];
if (options.all) {
  tests = findAllTests(options.folder);
} else {
  tests = options.tests;
}

const runTest = (testName: string) => {
  return new Promise(async function (resolve, reject) {
    const spawned: any = [];
    const testDir = fspath.resolve(options.folder + "/" + testName);
    let testModule = fspath.resolve(testDir + "/" + "test.js");
    const cmd = fspath.resolve(options.cli);
    const cwd = fspath.resolve(options.folder + "/" + testName);
    try {
      const imported = await import(testModule);
      const test = imported.default;
      type TesterState = {
        process: any;
        errors: string[];
        output: string[];
        pinger: Pinger | null;
        secondsIdle: number;
        idleEmitter: any;
        findIndex: { [key: string]: number };
        name: string;
        description: string;
        timeoutTime: number;
        timeout: NodeJS.Timeout | null;
      };
      await test(
        (
          attr: {
            name: string;
            description: string;
            args: string[];
            timeout: number;
          },
          args: string[]
        ) => {
          const state: TesterState = {
            process: null,
            errors: [],
            output: [],
            pinger: null,
            secondsIdle: 0,
            idleEmitter: null,
            findIndex: {} as { string: number },
            name: attr.name || "",
            description: attr.name || "",
            timeoutTime: attr.timeout,
            timeout: null,
          };
          return {
            dir: cwd,
            start: () => {
              state.timeout = state.timeoutTime
                ? setTimeout(() => {
                    console.log("Test timeout expired. Force quitting CLI.");
                    state.process.kill("SIGINT");
                    state.timeout = null;
                  }, attr.timeout)
                : null;
              state.process = spawn("node", [cmd, ...args], {
                stdio: ["pipe", "pipe", "pipe"],
                shell: true,
                cwd: cwd,
              });
              console.log("Test Run Started: " + attr.name);
              console.log("Description: " + attr.description);

              spawned.push(state.process); // keep track of all spawned processes

              state.process.on("spawn", () => {
                console.log("> " + "Spawned");
                state.idleEmitter = new emitter();
                state.pinger = new Pinger(
                  "idleTimer",
                  (id: string) => {
                    state.secondsIdle++;
                    state.idleEmitter.emit("tick", state.secondsIdle);
                  },
                  1000
                );
              });

              state.process.stdout.on("data", (data: Buffer) => {
                state.output.push(data.toString());
                state.secondsIdle = 0;
              });

              state.process.stderr.on("data", (data: Buffer) => {
                state.errors.push(data.toString());
                state.secondsIdle = 0;
              });

              state.process.on("close", (code: number, signal: string) => {
                if (state.timeout) {
                  clearTimeout(state.timeout);
                  state.timeout = null;
                }
                if (state.pinger != null) {
                  state.pinger.done();
                }
                if (code) {
                  console.log("> " + `child process closed with code ${code}`);
                }
                if (signal) {
                  console.log(
                    "> " +
                      `child process terminated due to receipt of signal ${signal}`
                  );
                }
              });

              state.process.on("exit", (code: number) => {
                if (state.timeout) {
                  clearTimeout(state.timeout);
                  state.timeout = null;
                }
                if (code) {
                  console.log("> " + `child process exited with code ${code}`);
                }
              });
            },
            stopped: () => {
              return new Promise(function (resolve) {
                if (!state.process) {
                  console.error(chalk.red("Test has not started."));
                  resolve(0);
                } else if (state.process.exitCode != null) {
                  resolve(state.process.exitCode);
                } else {
                  state.process.on("exit", () => {
                    resolve(state.process.exitCode);
                  });
                }
              });
            },
            forceStop: () => {
              if (state.process) {
                state.process.kill("SIGINT");
              } else {
                console.error(
                  chalk.red("Test has not started, nothing to force stop")
                );
              }
            },
            log: (message: string) => {
              console.log(chalk.blue("[" + state.name + "] ") + message);
            },
            error: (message: string) => {
              console.error(chalk.blue("[" + state.name + "] ") + message);
            },
            sleep: (ms: number) => {
              return new Promise((resolve) => setTimeout(resolve, ms));
            },
            waitUntilOutputIdleSeconds: (seconds: Number) => {
              // wait number of seconds since last stdout or stderr
              return new Promise(function (resolve) {
                if (!state.process) {
                  console.error(
                    chalk.red("Test has not started, nothing to wait for.")
                  );
                  resolve(0);
                  return;
                }
                if (state.secondsIdle >= seconds) {
                  resolve(state.secondsIdle);
                } else {
                  state.idleEmitter.on("tick", function (seconds: number) {
                    if (state.secondsIdle >= seconds) {
                      resolve(state.secondsIdle);
                    }
                  });
                }
              });
            },
            untilOutputIncludes: (search: string) => {
              // optimized so that we don't keep checking the entire
              // recorded output every time.  Can be called multiple times before
              // or after a search string is found.  to find the next time the
              // search occurs
              const _outIncludes = (search: string) => {
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
                  console.error(
                    chalk.red("Test has not started, no output to monitor.")
                  );
                  resolve(0);
                  return;
                }
                if (_outIncludes(search)) {
                  resolve(search);
                } else {
                  state.process.stdout.on("data", (data: Buffer) => {
                    if (_outIncludes(search)) {
                      resolve(search);
                    }
                  });
                }
              });
            },
          };
        }
      );
      resolve("success");
    } catch (error) {
      reject(error);
    } finally {
      spawned.forEach((p: any) => {
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

tests.forEach((testName: string) => {
  runTest(testName)
    .then(() => {
      console.log(chalk.green.bold("> Test Run Succeeded."));
    })
    .catch((error) => {
      console.error(chalk.red.bold("> Test Run Failed: "));
      console.error(chalk.red.bold(error));
    });
});
