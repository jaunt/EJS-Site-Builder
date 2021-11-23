#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const chokidar_1 = __importDefault(require("chokidar"));
const nconf_1 = __importDefault(require("nconf"));
const process_1 = __importDefault(require("process"));
const shared_1 = require("./shared");
const process_2 = require("process");
const airfry_1 = require("./airfry");
const version = "0.0.3"; // todo get version from git tag
const BAD_OPTIONS = 3;
console.log(chalk_1.default.black.bgWhite.bold("\n Air", chalk_1.default.white.bgBlue(" Fry \n")));
console.log(chalk_1.default.blueBright("Version " + version + "\n"));
const program = new commander_1.Command()
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
program.parse(process_1.default.argv);
const options = program.opts();
if (options.verbose) {
    console.log("Options detected:");
    console.log(options);
}
nconf_1.default.argv().env().file({ file: "./airfry.json" });
const optionsConfig = nconf_1.default.get("options") || {};
const getOption = (opt, def) => {
    if (options[opt] && optionsConfig[opt]) {
        console.log(chalk_1.default.yellow("Warning, command line argument " +
            chalk_1.default.white(opt) +
            " is overriding option specified in airfry.json"));
    }
    let result = options[opt] || optionsConfig[opt];
    if (!result) {
        if (options.verbose) {
            console.log(chalk_1.default.yellow("No option specified for " +
                chalk_1.default.white(opt) +
                ", using default value: " +
                chalk_1.default.green(def || "undefined")));
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
    if (fs_1.default.existsSync(outputDir)) {
        console.log(chalk_1.default.green("Clearing output dir: " + outputDir));
        fs_1.default.rmSync(outputDir, { recursive: true });
    }
}
if (watchOnly && noWatch) {
    console.log(chalk_1.default.red("Can't both watch and not watch!  Exiting."));
    (0, process_2.exit)(BAD_OPTIONS);
}
const isOneOrTheOtherRelative = (a, b) => {
    const result = (0, shared_1.isRelative)(a, b) || (0, shared_1.isRelative)(b, a);
    if (result) {
        console.log(chalk_1.default.red("Directories must not contian each other: " + chalk_1.default.white(a + ", " + b)));
    }
    return result;
};
if (isOneOrTheOtherRelative(inputDir, dataDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(inputDir, outputDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(cacheDir, outputDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(dataDir, outputDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(dataDir, cacheDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
const airfry = new airfry_1.AirFry(inputDir, dataDir, outputDir, cacheDir);
// We want to the cache to store to disk whenever we exit.
// simplified from:
// https://github.com/sindresorhus/exit-hook
// https://github.com/sindresorhus/exit-hook/blob/main/license
let _exited = false;
const onExit = (shouldExit, signal) => {
    if (_exited)
        return;
    _exited = true;
    airfry.storeCache();
    if (shouldExit === true) {
        process_1.default.exit(128 + signal);
    }
};
process_1.default.once("exit", onExit);
process_1.default.once("SIGINT", onExit.bind(undefined, true, 2));
process_1.default.once("SIGTERM", onExit.bind(undefined, true, 15));
process_1.default.on("message", (message) => {
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
            console.log(chalk_1.default.redBright.bold.bgWhite("Errors detected: " + errors));
        }
        else {
            console.log(chalk_1.default.green("Zero errors detected."));
        }
        if (options.noWatch) {
            console.log(`All files written.  No-watch option ending program now.`);
            return;
        }
        console.log(`All files written.  Watching for changes.`);
        const watcher = chokidar_1.default.watch([inputDir, dataDir], {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100,
            },
        });
        let pinger = new shared_1.Pinger("error scan", (id) => {
            const newCount = airfry.getErrorCount();
            if (newCount > errors) {
                console.log(chalk_1.default.redBright.bold.bgWhite("New errors detected: " + (newCount - errors)));
                errors = newCount;
            }
        }, 1000);
        const getKind = (p) => {
            const checks = [
                {
                    kind: "data",
                    prefix: path_1.default.join(dataDir),
                },
                {
                    kind: airfry_1.PRE_GENERATE_NAME,
                    prefix: path_1.default.join(inputDir, airfry_1.PRE_GENERATE_JS),
                },
                {
                    kind: airfry_1.POST_GENERATE_NAME,
                    prefix: path_1.default.join(inputDir, airfry_1.POST_GENERATE_JS),
                },
                {
                    kind: "template",
                    prefix: path_1.default.join(inputDir),
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
        const applyChange = (p) => {
            pinger.restart();
            const check = getKind(p);
            if (check.kind == airfry_1.PRE_GENERATE_NAME) {
                airfry
                    .processPreGenerate()
                    .then(() => {
                    console.log(chalk_1.default.green("Pre Generate JS updated -- updating deps"));
                    airfry.updatGlobalDeps();
                })
                    .catch((error) => {
                    console.log(chalk_1.default.red("Pre Generate JS update error: "));
                    console.log(chalk_1.default.red(error));
                });
            }
            else if (check.kind == airfry_1.POST_GENERATE_NAME) {
                airfry
                    .processPostGenerate()
                    .then(() => {
                    console.log(chalk_1.default.green("Post Generate JS updated"));
                })
                    .catch((error) => {
                    console.log(chalk_1.default.red("Post Generate JS update error: "));
                    console.log(chalk_1.default.red(error));
                });
            }
            else if (check.kind == "template") {
                // step 1. update the template itself,
                airfry
                    .processTemplateFilesPromise(airfry.getTemplateFileName(check.name))
                    .then((updateList) => {
                    console.log(chalk_1.default.green("Template Updated: " + p));
                    // render it:
                    // step 2. ... then any other templates depending on it
                    airfry.updateTemplateDeps(updateList[0]);
                })
                    .catch((error) => {
                    console.log(chalk_1.default.red("Template update error: "));
                    console.log(chalk_1.default.red(error));
                });
            }
            else if (check.kind == "data") {
                const dataFileName = path_1.default.resolve(dataDir + "/" + check.name);
                airfry.updateDataDeps(dataFileName);
            }
        };
        watcher
            .on("add", (p) => {
            applyChange(p);
        })
            .on("change", (p) => {
            applyChange(p);
        })
            .on("unlink", (p) => {
            console.log(`${p} has been removed`);
            // deleting dependencies will likely cause parents to complain!
            applyChange(p);
        })
            .on("unlinkDir", (path) => console.log(`Directory ${path} has been removed`));
    })
        .catch((error) => {
        console.log(chalk_1.default.red(error));
    });
}
//# sourceMappingURL=cli.js.map