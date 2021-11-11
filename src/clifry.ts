#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
const { spawn } = require("child_process");

const version = "0.0.1"; // todo get version from git tag

console.log(chalk.black.bgWhite.bold("\n CLI", chalk.white.bgBlue(" FRY ")));
console.log(chalk.blueBright("Version " + version + "\n"));
const program = new Command().requiredOption(
  "-t, --tests [tests...]",
  "Test name or names"
);

program.version(version);
program.parse(process.argv);
const options = program.opts();

console.log(options);

const runTest = (testName: string) => {
  return new Promise(async function (resolve, reject) {
    const spawned: any = [];
    const testDir = process.cwd() + "/tests/" + testName + "/";
    let testModule = testDir + "test.js";
    const cmd = process.cwd() + "/lib/cli.js";
    const cwd = process.cwd() + "/tests/" + testName;
    try {
      const imported = await import(testModule);
      const test = imported.default;
      type TesterState = {
        process: any;
        errors: string[];
        name: string;
        description: string;
        timeout: NodeJS.Timeout | null;
      };
      const result = await test({
        start: (attr: any, args: string[]) => {
          const state: TesterState = {
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

          console.log("Test Run Started:");
          console.log(attr);

          spawned.push(state.process); // keep track of all spawned processes

          state.process.on("spawn", () => {
            console.log("spawned");
          });

          state.process.stderr.on("data", (data: string) => {
            state.errors.push(data);
            console.error(chalk.red.bold(`${data}`));
          });

          state.process.on("close", (code: number, signal: string) => {
            if (state.timeout) {
              clearTimeout(state.timeout);
              state.timeout = null;
            }
            if (code) {
              console.log(`child process closed with code ${code}`);
            }
            if (signal) {
              console.log(
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
              console.log(`child process exited with code ${code}`);
            }
          });

          return {
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
          };
        },
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

const tests = options.tests;
tests.forEach((testName: string) => {
  runTest(testName)
    .then(() => {
      console.log(chalk.green.bold("Succeeded."));
    })
    .catch((error) => {
      console.error(chalk.green.bold("Failed: " + error));
    });
});
