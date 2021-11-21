#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import fspath from "path";
const { spawn } = require("child_process");

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
        findIndex: { [key: string]: number };
        name: string;
        description: string;
        timeout: NodeJS.Timeout | null;
      };
      await test((attr: any, args: string[]) => {
        const state: TesterState = {
          process: spawn("node", [cmd, ...args], {
            stdio: "pipe",
            shell: true,
            cwd: cwd,
          }),
          errors: [],
          output: [],
          findIndex: {} as { string: number },
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

        state.process.stdout.on("data", (data: Buffer) => {
          state.output.push(data.toString());
        });

        state.process.stderr.on("data", (data: Buffer) => {
          state.errors.push(data.toString());
        });

        state.process.on("close", (code: number, signal: string) => {
          if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
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

        return {
          dir: cwd,
          stopped: () => {
            return new Promise(function (resolve) {
              if (state.process.exitCode != null) {
                resolve(state.process.exitCode);
              } else {
                state.process.on("exit", () => {
                  resolve(state.process.exitCode);
                });
              }
            });
          },
          forceStop: () => {
            state.process.kill("SIGINT");
          },
          log: (message: string) => {
            console.log(chalk.blue("[" + state.name + "] ") + message);
          },
          error: (message: string) => {
            console.error(chalk.blue("[" + state.name + "] ") + message);
          },
          writeFile: (file: string, data: string) => {
            fs.writeFileSync(file, data);
          },
          sleep: (ms: number) => {
            return new Promise((resolve) => setTimeout(resolve, ms));
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
              if (state.findIndex[search] == state.output.length) return false;
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
      });
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
