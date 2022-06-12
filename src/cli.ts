#!/usr/bin/env node
import { Command } from "commander";
import fspath from "path";
import pico from "picocolors";
const { promises: fs } = require("fs");
import chokidar from "chokidar";
import nconf from "nconf";
import process from "process";

import { isRelative, Pinger, makeLoggers } from "@danglingdev/shared-ts";
import { exit } from "process";

import {
  Templer,
  PRE_GENERATE_JS,
  PRE_GENERATE_NAME,
  POST_GENERATE_JS,
  POST_GENERATE_NAME,
  Dependencies,
  TriggerReason,
} from "./api";

// this is only safe because templer is a stand-alone cli, not a module
const LIB_VERSION = require("../package.json").version;

const BAD_OPTIONS = 3;

console.log(pico.black(pico.bgWhite(pico.bold("\n TEMPLER \n"))));
console.log(pico.blue("Version " + LIB_VERSION + "\n"));

const loggers = makeLoggers("@ ");
const log = loggers.log;
const logError = loggers.logError;

const program = new Command()
  .option("-i, --input <inputDir>", "input directory")
  .option("-d, --data <dataDir>", "data directory")
  .option("-o, --output <outputDir>", "output directory")
  .option("-o, --public <publicDir>", "public directory")
  .option("-c, --cache <cacheDir>", "cache directory")
  .option("-nw, --noWatch", "quit after processing all templates")
  .option("-wo, --watchOnly", "don't process at start, only watch")
  .option("-cc, --clearCache", "clear cache on start")
  .option("-v, --verbose", "logging verbosity");

program.version(LIB_VERSION);
program.parse(process.argv);
const options = program.opts();

nconf.argv().env().file({ file: "./templer.json" });
const optionsConfig = nconf.get("options") || {};

const getOption = (opt: string, def: string): string => {
  if (options[opt] && optionsConfig[opt]) {
    log(
      pico.yellow(
        "Warning, command line argument " +
          pico.white(opt) +
          " is overriding option specified in templer.json"
      )
    );
  }
  let result = options[opt] || optionsConfig[opt];
  if (!result) {
    if (options.verbose || optionsConfig.verbose) {
      log(
        pico.yellow(
          "No option specified for " +
            pico.white(opt) +
            ", using default value: " +
            pico.green(def || "undefined")
        )
      );
    }
    result = def;
  }
  return result;
};

const inputDir = getOption("input", "./templer/input");
const dataDir = getOption("data", "./templer/data");
const outputDir = getOption("output", "./templer/output");
const publicDir = getOption("public", "");
const cacheDir = getOption("cache", "./templer/cache");
const verbose = getOption("verbose", "");
const noWatch = getOption("noWatch", "");
const watchOnly = getOption("watchOnly", "");

if (verbose) {
  log("Options detected:");
  log(
    JSON.stringify(
      {
        input: inputDir,
        output: outputDir,
        data: dataDir,
        public: publicDir,
        cache: cacheDir,
        noWatch: noWatch,
        watchOnly: watchOnly,
      },
      null,
      "\t"
    )
  );
}

if (watchOnly && noWatch) {
  logError("Can't both watch and not watch!  Exiting.");
  exit(BAD_OPTIONS);
}

const isOneOrTheOtherRelative = (a: string, b: string): Boolean => {
  const result = isRelative(a, b) || isRelative(b, a);
  if (result) {
    logError(
      "Directories must not contian each other: " + pico.white(a + ", " + b)
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

//https://stackoverflow.com/questions/39106516/node-fs-copy-a-folder
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  let entries = await fs.readdir(src, { withFileTypes: true });

  for (let entry of entries) {
    let srcPath = fspath.join(src, entry.name);
    let destPath = fspath.join(dest, entry.name);

    entry.isDirectory()
      ? await copyDir(srcPath, destPath)
      : await fs.copyFile(srcPath, destPath);
  }
}

if (publicDir) {
  if (verbose) {
    log("Recursively copying from " + publicDir + " to " + outputDir);
  }
  copyDir(publicDir, outputDir);
}

const templer = new Templer(inputDir, dataDir, outputDir, cacheDir, verbose);

// We want to the cache to store to disk whenever we exit.
// simplified from:
// https://github.com/sindresorhus/exit-hook
// https://github.com/sindresorhus/exit-hook/blob/main/license
let _exited = false;
const onExit = (shouldExit: boolean, signal: number) => {
  if (_exited) return;
  _exited = true;
  templer.storeCache();
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

const watcher = chokidar.watch([inputDir, dataDir], {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 100,
  },
});

let pinger: Pinger;

let deps: Dependencies = {};

const startWatching = () => {
  // step 3. watch src directory
  let errors = templer.getErrorCount();

  if (errors > 0) {
    logError("Errors detected: " + errors);
  } else {
    log("Zero errors detected.");
  }

  if (options.noWatch) {
    log(`All files written.  No-watch option ending program now.`);
    watcher.close().then(() => console.log("closed"));
    return;
  }

  log(`All files written.  Watching for changes.`);

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
          name: p.slice(check.prefix.length + 1),
        };
      }
    }
    return {
      kind: "",
      name: "",
    };
  };

  const queueChange = (
    p: string,
    reason: TriggerReason = TriggerReason.Modified
  ) => {
    pinger.restart();
    const check = getKind(p);
    if (check.kind == PRE_GENERATE_NAME) {
      templer
        .processPreGenerate()
        .then(() => {
          log("Pre Generate JS updated -- updating deps");
          deps = { ...deps, ...templer.getGlobalDeps() };
        })
        .catch((error) => {
          logError("Pre Generate JS update error: ", error);
        });
    } else if (check.kind == POST_GENERATE_NAME) {
      templer
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
      if (reason == TriggerReason.Added || reason == TriggerReason.Modified) {
        // step 1. update the template itself,
        templer
          .processTemplateFilesPromise(templer.getTemplateFileName(check.name))
          .then((updateList) => {
            log("Template Updated: " + p);
            // render it:
            // step 2. ... then any other templates depending on it
            deps = { ...deps, ...templer.getTemplateDeps(updateList[0]) };
            log("Ready to update deps:");
            log(JSON.stringify(deps));
          })
          .catch((error) => {
            logError("Template update error: ", error);
          });
      } else if (reason == TriggerReason.Deleted) {
        // step 1. clean up the template.  this will surely
        // produce errors from anything depending on it.
        templer.processDeletedTemplatePromise(
          templer.getTemplateFileName(check.name)
        );
      }
    } else if (check.kind == "data") {
      // when it's data, we need to process separately for
      // every file in case a generator can rebuild for a single file.
      const dataFileName = fspath.resolve(dataDir + "/" + check.name);
      const dataDeps = templer.getDataDeps(dataFileName);
      templer.updateDeps(dataDeps, dataFileName, reason);
    }
  };

  watcher
    .on("add", (p: string) => {
      queueChange(p, TriggerReason.Added);
    })
    .on("change", (p) => {
      queueChange(p, TriggerReason.Modified);
    })
    .on("unlink", (p) => {
      log(`${p} has been removed`);
      // deleting dependencies will likely cause parents to complain!
      queueChange(p, TriggerReason.Deleted);
    })
    .on("unlinkDir", (path) => log(`Directory ${path} has been removed`));

  pinger = new Pinger(
    "watcher",
    (id: string) => {
      pinger.stop();
      templer
        .updateDeps({ ...deps })
        .then(() => {
          log("Dependencies updated.");
        })
        .catch((error) => {
          logError(error);
        })
        .finally(() => {
          deps = {};
          const newCount = templer.getErrorCount();
          if (newCount > errors) {
            logError("New errors detected: " + (newCount - errors));
            errors = newCount;
          }
          pinger.restart();
        });
    },
    50
  );
};

if (!watchOnly) {
  // step 1:  process global.js
  templer
    .processPreGenerate()
    .then(() => {
      // step 2. process existing src files
      return templer.processTemplateFilesPromise();
    })
    .then(() => {
      // step 3. wait until first batch page generation
      return templer.generatePages();
    })
    .then(() => {
      // step 3. wait until first batch page generation
      return templer.processPostGenerate();
    })
    .then(() => {
      startWatching();
    })
    .catch((error) => {
      logError(error);
    });
} else {
  templer
    .processPreGenerate()
    .then(() => {
      // step 2. process existing src files
      return templer.processTemplateFilesPromise();
    })
    .then(() => {
      startWatching();
    })
    .catch((error) => {
      logError(error);
    });
}
