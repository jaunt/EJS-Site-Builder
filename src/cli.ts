#!/usr/bin/env node
import { Command, Option } from "commander";
import fs from "fs";
import fspath from "path";
import chalk from "chalk";
import chokidar from "chokidar";
import nconf from "nconf";

import { isRelative } from "./shared";
import { exit } from "process";

import {
  AirFry,
  PRE_GENERATE_JS,
  PRE_GENERATE_NAME,
  POST_GENERATE_JS,
  POST_GENERATE_NAME,
} from "./airfry";

const version = "0.0.1"; // todo get version from git tag

const BAD_OPTIONS = 3;

console.log(chalk.black.bgWhite.bold("\n Air", chalk.white.bgBlue(" Fry \n")));
console.log(chalk.blueBright("Version " + version + "\n"));
const program = new Command();

program.addOption(new Option("-i, --input <inputDir>", "input directory"));
program.addOption(new Option("-d, --data <dataDir>", "data directory"));
program.addOption(new Option("-o, --output <outputDir>", "output directory"));
program.addOption(
  new Option("-t, --temp <tempDir>", "temp file directory (cache)")
);
program.addOption(
  new Option("-nw, --noWatch", "quit after processing all templates")
);
program.addOption(
  new Option("-wo, --watchOnly", "don't process at start, only watch")
);
program.addOption(
  new Option("-k, --keepOutDir", "clear output directory on start")
);
program.addOption(new Option("-cc, --clearCache", "clear cache on start"));

program.version(version);
program.parse(process.argv);
const options = program.opts();

nconf.argv().env().file({ file: "./airfry.json" });
const optionsConfig = nconf.get("options");

const getOption = (opt: string, def: string): string => {
  if (options[opt] && optionsConfig[opt]) {
    console.log(
      chalk.yellow(
        "Warning, command line argument " +
          chalk.white(opt) +
          " is overriding option specified in airfry.json"
      )
    );
  }
  let result = options[opt] || optionsConfig[opt];
  if (!result) {
    chalk.yellow(
      "No option specified for " +
        chalk.white(opt) +
        ", using default value: " +
        chalk.green(def)
    );
    result = def;
  }
  return def;
};

const inputDir = getOption("input", "/airfry-input");
const dataDir = getOption("input", "/airfry-data");
const outputDir = getOption("output", "./airfry-output");
const tempDir = getOption("temp", "./airfry-temp");

const keepOutDir = getOption("keepOutDir", "");
const noWatch = getOption("noWatch", "");
const watchOnly = getOption("watchOnly", "");

if (!keepOutDir) {
  if (fs.existsSync(outputDir)) {
    chalk.green("Clearing output dir: " + outputDir);
    fs.rmSync(outputDir, { recursive: true });
  }
}

if (!fs.existsSync(tempDir)) {
  chalk.green("Making temp dir: " + tempDir);
  fs.mkdirSync(tempDir, { recursive: true });
}

if (watchOnly && noWatch) {
  chalk.red("Can't both watch and not watch!  Exiting.");
  exit(BAD_OPTIONS);
}

const isOneOrTheOtherRelative = (a: string, b: string): Boolean => {
  const result = isRelative(a, b) || isRelative(b, a);
  if (result) {
    chalk.red(
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

if (isOneOrTheOtherRelative(tempDir, outputDir)) {
  exit(BAD_OPTIONS);
}

if (isOneOrTheOtherRelative(dataDir, outputDir)) {
  exit(BAD_OPTIONS);
}

if (isOneOrTheOtherRelative(dataDir, tempDir)) {
  exit(BAD_OPTIONS);
}

const airfry = new AirFry(inputDir, dataDir, outputDir, tempDir);

if (!watchOnly) {
  // step 1:  process global.js
  airfry
    .processGeneratePre()
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
      return airfry.processGeneratePost();
    })
    .then(() => {
      // step 3. watch src directory

      if (options.noWatch) {
        console.log(`All files written.  No-watch option ending program now.`);
        return;
      }

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
            kind: "template",
            prefix: fspath.join(inputDir),
          },
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

      watcher
        .on("add", (p: string) => {
          const check = getKind(p);
          if (check.kind == PRE_GENERATE_NAME) {
            airfry.updatGlobalDeps();
          } else if (check.kind == "template") {
            airfry.processTemplateFilesPromise(p).then(() => {
              console.log(chalk.green("New file processed: " + p));
            });
          } else if (check.kind == "data") {
            // if anyone was watching the file or entire data directory
            const dataFileName = fspath.resolve(dataDir + "/" + check.name);
            airfry.updateDataDeps(dataFileName);
          }
        })
        .on("change", (p) => {
          const check = getKind(p);
          if (check.kind == PRE_GENERATE_NAME) {
            airfry
              .processGeneratePre()
              .then(() => {
                console.log(
                  chalk.green("Pre Generate JS updated -- updating deps")
                );
                airfry.updatGlobalDeps();
              })
              .catch((error) => {
                console.log(chalk.red("Pre Generate JS update error: "));
                console.log(chalk.red(error));
              });
          } else if (check.kind == POST_GENERATE_NAME) {
            airfry
              .processGeneratePost()
              .then(() => {
                console.log(chalk.green("Post Generate JS updated"));
              })
              .catch((error) => {
                console.log(chalk.red("Post Generate JS update error: "));
                console.log(chalk.red(error));
              });
          } else if (check.kind == "template") {
            // step 1. update the template itself,
            airfry
              .processTemplateFilesPromise(
                airfry.getTemplateFileName(check.name)
              )
              .then((updateList) => {
                console.log(chalk.green("Template Updated: " + p));
                // render it:
                // step 2. ... then any other templates depending on it
                airfry.updateTemplateDeps(updateList[0]);
              })
              .catch((error) => {
                console.log(chalk.red("Template update error: "));
                console.log(chalk.red(error));
              });
          } else if (check.kind == "data") {
            const dataFileName = fspath.resolve(dataDir + "/" + check.name);
            airfry.updateDataDeps(dataFileName);
          }
        })
        .on("unlink", (path) => console.log(`File ${path} has been removed`))
        .on("unlinkDir", (path) =>
          console.log(`Directory ${path} has been removed`)
        );
    })
    .catch((error) => {
      console.log(chalk.red(error));
    });
}
