#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import fspath from "path";
import chalk from "chalk";
import chokidar from "chokidar";
import nconf from "nconf";
import process from "process";

import { isRelative, Pinger, makeLoggers } from "./shared";
import { exit } from "process";

import {
  AirFry,
  PRE_GENERATE_JS,
  PRE_GENERATE_NAME,
  POST_GENERATE_JS,
  POST_GENERATE_NAME,
  Dependencies,
} from "./airfry";

const version = "0.0.3"; // todo get version from git tag

const BAD_OPTIONS = 3;

console.log(chalk.black.bgWhite.bold("\n Air", chalk.white.bgBlue(" Fry \n")));
console.log(chalk.blueBright("Version " + version + "\n"));

const loggers = makeLoggers("@ ");
const log = loggers.log;
const logError = loggers.logError;

const program = new Command()
  .option("-i, --input <inputDir>", "input directory")
  .option("-d, --data <dataDir>", "data directory")
  .option("-o, --output <outputDir>", "output directory")
  .option("-c, --cache <cacheDir>", "cache directory")
  .option("-nw, --noWatch", "quit after processing all templates")
  .option("-wo, --watchOnly", "don't process at start, only watch")
  .option("-k, --keepOutDir", "clear output directory on start")
  .option("-cc, --clearCache", "clear cache on start")
  .option("-v, --verbose", "logging verbosity");

program.version(version);
program.parse(process.argv);
const options = program.opts();

if (options.verbose) {
  log("Options detected:");
  log(options);
}

nconf.argv().env().file({ file: "./airfry.json" });
const optionsConfig = nconf.get("options") || {};

const getOption = (opt: string, def: string): string => {
  if (options[opt] && optionsConfig[opt]) {
    log(
      chalk.yellow(
        "Warning, command line argument " +
          chalk.white(opt) +
          " is overriding option specified in airfry.json"
      )
    );
  }
  let result = options[opt] || optionsConfig[opt];
  if (!result) {
    if (options.verbose) {
      log(
        chalk.yellow(
          "No option specified for " +
            chalk.white(opt) +
            ", using default value: " +
            chalk.green(def || "undefined")
        )
      );
    }
    result = def;
  }
  return result;
};

const inputDir = getOption("input", "./airfry-input");
const dataDir = getOption("data", "./airfry-data");
const outputDir = getOption("output", "./airfry-output");
const cacheDir = getOption("cache", "./airfry-cache");

const keepOutDir = getOption("keepOutDir", "");
const noWatch = getOption("noWatch", "");
const watchOnly = getOption("watchOnly", "");

if (!keepOutDir) {
  if (fs.existsSync(outputDir)) {
    log("Clearing output dir: " + outputDir);
    fs.rmSync(outputDir, { recursive: true });
  }
}

if (watchOnly && noWatch) {
  logError("Can't both watch and not watch!  Exiting.");
  exit(BAD_OPTIONS);
}

const isOneOrTheOtherRelative = (a: string, b: string): Boolean => {
  const result = isRelative(a, b) || isRelative(b, a);
  if (result) {
    logError(
      "Directories must not contian each other: " + chalk.white(a + ", " + b)
    );
  }
  return result;
};

if (isOneOrTheOtherRelative(inputDir, dataDir)) {
  exit(BAD_OPTIONS);
}

if (isOneOrTheOtherRelative(inputDir, outputDir)) {
  exit(BAD_OPTIONS);
}

if (isOneOrTheOtherRelative(cacheDir, outputDir)) {
  exit(BAD_OPTIONS);
}

if (isOneOrTheOtherRelative(dataDir, outputDir)) {
  exit(BAD_OPTIONS);
}

if (isOneOrTheOtherRelative(dataDir, cacheDir)) {
  exit(BAD_OPTIONS);
}

const airfry = new AirFry(inputDir, dataDir, outputDir, cacheDir);

// We want to the cache to store to disk whenever we exit.
// simplified from:
// https://github.com/sindresorhus/exit-hook
// https://github.com/sindresorhus/exit-hook/blob/main/license
let _exited = false;
const onExit = (shouldExit: boolean, signal: number) => {
  if (_exited) return;
  _exited = true;
  airfry.storeCache();
  if (shouldExit === true) {
    process.exit(128 + signal);
  }
};
process.once("exit", onExit);
process.once("SIGINT", onExit.bind(undefined, true, 2));
process.once("SIGTERM", onExit.bind(undefined, true, 15));
process.on("message", (message) => {
  if (message === "shutdown") {
    onExit(true, -128);
  }
});

if (!watchOnly) {
  // step 1:  process global.js
  airfry
    .processPreGenerate()
    .then(() => {
      // step 2. process existing src files
      return airfry.processTemplateFilesPromise();
    })
    .then(() => {
      // step 3. wait until first batch page generation
      return airfry.generatePages();
    })
    .then(() => {
      // step 3. wait until first batch page generation
      return airfry.processPostGenerate();
    })
    .then(() => {
      // step 3. watch src directory

      let errors = airfry.getErrorCount();

      if (errors > 0) {
        logError("Errors detected: " + errors);
      } else {
        log("Zero errors detected.");
      }

      if (options.noWatch) {
        log(`All files written.  No-watch option ending program now.`);
        return;
      }

      log(`All files written.  Watching for changes.`);

      const watcher = chokidar.watch([inputDir, dataDir], {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 100,
        },
      });

      const getKind = (p: string) => {
        const checks = [
          {
            kind: "data",
            prefix: fspath.join(dataDir),
          },
          {
            kind: PRE_GENERATE_NAME,
            prefix: fspath.join(inputDir, PRE_GENERATE_JS),
          },
          {
            kind: POST_GENERATE_NAME,
            prefix: fspath.join(inputDir, POST_GENERATE_JS),
          },
          {
            kind: "template",
            prefix: fspath.join(inputDir),
          },
        ];
        for (const check of checks) {
          if (p.startsWith(check.prefix)) {
            return {
              kind: check.kind,
              name: p.substr(check.prefix.length + 1),
            };
          }
        }
        return {
          kind: "",
          name: "",
        };
      };

      let pinger: Pinger;

      let deps: Dependencies = {};

      const queueChange = (p: string) => {
        pinger.restart();
        const check = getKind(p);
        if (check.kind == PRE_GENERATE_NAME) {
          airfry
            .processPreGenerate()
            .then(() => {
              log("Pre Generate JS updated -- updating deps");
              deps = { ...deps, ...airfry.getGlobalDeps() };
            })
            .catch((error) => {
              logError("Pre Generate JS update error: ", error);
            });
        } else if (check.kind == POST_GENERATE_NAME) {
          airfry
            .processPostGenerate()
            .then(() => {
              log("Post Generate JS updated");
              // nothing can depend on post generate
            })
            .catch((error) => {
              logError("Post Generate JS update error: ");
              log(error);
            });
        } else if (check.kind == "template") {
          // step 1. update the template itself,
          airfry
            .processTemplateFilesPromise(airfry.getTemplateFileName(check.name))
            .then((updateList) => {
              log("Template Updated: " + p);
              // render it:
              // step 2. ... then any other templates depending on it
              deps = { ...deps, ...airfry.getTemplateDeps(updateList[0]) };
            })
            .catch((error) => {
              logError("Template update error: ", error);
            });
        } else if (check.kind == "data") {
          // when it's data, we need to process separately for
          // every file in case a generator can rebuild for a single file.
          const dataFileName = fspath.resolve(dataDir + "/" + check.name);
          const dataDeps = airfry.getDataDeps(dataFileName);
          airfry.updateDeps(dataDeps, dataFileName);
        }
      };

      watcher
        .on("add", (p: string) => {
          queueChange(p);
        })
        .on("change", (p) => {
          queueChange(p);
        })
        .on("unlink", (p) => {
          log(`${p} has been removed`);
          // deleting dependencies will likely cause parents to complain!
          queueChange(p);
        })
        .on("unlinkDir", (path) => log(`Directory ${path} has been removed`));

      pinger = new Pinger(
        "watcher",
        (id: string) => {
          pinger.stop();
          airfry
            .updateDeps({ ...deps })
            .then(() => {
              log("Dependencies updated.");
            })
            .catch((error) => {
              logError(error);
            })
            .finally(() => {
              deps = {};
              const newCount = airfry.getErrorCount();
              if (newCount > errors) {
                logError("New errors detected: " + (newCount - errors));
                errors = newCount;
              }
              pinger.restart();
            });
        },
        250
      );
    })
    .catch((error) => {
      logError(error);
    });
}
