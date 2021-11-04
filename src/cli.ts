#!/usr/bin/env node
//import { Command } from 'commander';
import ejs from "ejs";

import vm from "vm";
import fs from "fs";
import fspath from "path";
import fm from "front-matter";
import chalk from "chalk";
import chokidar from "chokidar";
import micromatch from "micromatch";
import nconf from "nconf";

nconf.argv().env().file({ file: "./airfry.json" });
const pathConfig = nconf.get("paths");
let sourceDir = pathConfig?.sourceDir || "./airfry";
let outputDir = pathConfig?.outputDir || "./output";
let tempDir = sourceDir + "/tmp";
const optionsConfig = nconf.get("options");
let clearOutDir = optionsConfig?.clearOutDir || true;

const libDir = "/js";

const PRE_GENERATE_JS = "preGenerate.js";
const PRE_GENERATE_NAME = "PRE_GENERATE";
const POST_GENERATE_JS = "postGenerate.js";
const POST_GENERATE_NAME = "POST_GENERATE";
const TEMPLATE_DIR = "/templates";
const DATA_DIR = "/data";
const SCRIPT_ENTRY = "<script entry>";
const SCRIPT_ENTRY_LENGTH = SCRIPT_ENTRY.length;
const SCRIPT_LIB = "<script lib>";
const SCRIPT_LIB_LENGTH = SCRIPT_LIB.length;
const SCRIPT_GENERATE = "<script generate>";
const SCRIPT_GENERATE_LENGTH = SCRIPT_GENERATE.length;
const END_SCRIPT = "</script>";
const END_SCRIPT_LENGTH = END_SCRIPT.length;
const EXTRACT_SCRIPT = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;

type Code = string;
type PageName = string;
type TemplateName = string;
type Path = string;

type Script = {
	[key: PageName]: Code;
};

type Dependencies = {
	[key: PageName]: boolean;
};

type DependencyTree = {
	[key: string]: Dependencies;
};

type FrontMatterEntries = {
  [key: string]: unknown
};

type FrontMatter = {
	[key: PageName]: FrontMatterEntries;
};

type CompiledTemplate = {
	[key: PageName]: ejs.ClientFunction;
};

type ToGenerateData = {
	name: PageName,
	generate?: string,
	triggeredBy: string,
};

type ToGenerate = {
	[key: string]: ToGenerateData
}

type PageData = {
	[key: string]: unknown
};

type CacheItem = {
	expires: number,
	data: PageData,
};

type CacheData = {
  [key: string]: CacheItem
}

type Cache = {
	[key: PageName]:  CacheData;
}

type FilesWritten = {
	[key: string]: Path
};

type State = {
	html: FilesWritten,
	entry: FilesWritten,
	lib: FilesWritten,
	json: FilesWritten
};

type PageGenerateRequest = {
  path: string,
  data: PageData,
}

type GeneratorResponse = {
  cache: CacheData,
  siteFiles: {[key: Path]: unknown},
  generate: PageGenerateRequest[],
  watchFiles: Path[],
  watchGlobs: string[],
  global: PageData,
}

type AirFryData = {
	generateScripts: Script,
	entryScripts: Script,
	templateDepTree: DependencyTree,
	pathDepTree: DependencyTree,
	wildDepTree: DependencyTree,
	globalDeps: Dependencies,
	frontMatter: FrontMatter
	templates: CompiledTemplate,
	toGenerate: ToGenerate,
	globalData: PageData,
	cache: Cache,
	state: State,
}

const local: AirFryData = {
	generateScripts: {},
	entryScripts: {},
	templateDepTree: {},
	pathDepTree: {},
	wildDepTree: {},
	globalDeps: {},
	frontMatter: {},
	templates: {},
	toGenerate: {},
	globalData: {},
	cache: {},
	state: {
		html: {},
		entry: {},
		lib: {},
		json: {}
	},
};


/// ----------------------------------------------------------------------------
/// Safety to prevent user from accidently
/// writing files outside the output directory
/// ----------------------------------------------------------------------------
const _outpath = fspath.resolve("./" + outputDir);
const isRelative = (parent: string, dir: string) : Boolean => {
  const relative = fspath.relative(parent, dir);
  return (
    Boolean(relative == "") ||
    (Boolean(relative) && !relative.startsWith("..") && !fspath.isAbsolute(relative))
  );
};

type fsFunc = (...args: any[]) => unknown

function safeOutputCheck(func: fsFunc, path: string, ...args: unknown[]) {
  if (!isRelative(_outpath, path)) {
    throw "Trying to write " + path + " which is outside of " + _outpath;
  }
  func(...args.slice(1));
}
const writeFileSafe = safeOutputCheck.bind(null, fs.writeFile);
const mkdirSyncSafe = safeOutputCheck.bind(null, fs.mkdirSync);

/// -----------------------------------------------------------------------------
/// Scanning for files
/// -----------------------------------------------------------------------------
const getAllFiles = function (dirPath: string, arrayOfFiles?: string[]) : string[] {
	const aof:string[] = arrayOfFiles || [];
	try {
    const files = fs.readdirSync(dirPath);
    files.forEach(function (file) {
      if (fs.statSync(dirPath + "/" + file).isDirectory()) {
        arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
      } else {
        aof.push(fspath.join("./", dirPath, "/", file));
      }
    });
  } catch (error) {
    console.log(chalk.red(error));
    arrayOfFiles = [];
  }
  return aof;
};

const getDataFileNames = function (dataDir: Path) : string[] {
  return getAllFiles(sourceDir + DATA_DIR + "/" + (dataDir || ""));
};

const getTemplateFileName = function (file: Path)  : string{
  const p = fspath.join("./", sourceDir + TEMPLATE_DIR, "/", file);
  return p;
};

/// -----------------------------------------------------------------------------
/// Caching
/// -----------------------------------------------------------------------------
const expireCache = () : void => {
  for (const pageName in local.cache) {
    const pageCache = local.cache[pageName];
    for (const itemName in pageCache) {
      const expires = pageCache[itemName].expires;
      if (expires) {
        if (!isNaN(expires)) {
          const now = new Date().getTime();
          if (now > expires) {
            console.log(
              chalk.green("Expired " + pageName + " cache item: " + itemName)
            );
            delete pageCache[itemName];
          }
        } else {
          throw new Error(
            pageName + " cache item " + itemName + " expires date is invalid"
          );
        }
      }
    }
  }
};
const loadCache = () : void => {
  if (fs.existsSync(tempDir + "/cache.json")) {
    let rawdata = fs.readFileSync(tempDir + "/cache.json");
    if (rawdata && rawdata.length > 0) {
      local.cache = JSON.parse(rawdata.toString());
    }
  }
};
const storeCache = () : void => {
  let data = JSON.stringify(local.cache);
  fs.writeFile(tempDir + "/cache.json", data, (err) => {
    if (err) throw err;
  });
};

/// -----------------------------------------------------------------------------
/// Helpers
/// -----------------------------------------------------------------------------
const getGlobalDataAccessProxy = (name: PageName) : typeof Proxy => {
  const globalDataAccessHandler = {
    get: function (...args: any) {
      // access to global deps was detected
      local.globalDeps[name] = true;
      return Reflect.get.apply(null, args);
    },
  };
  return new Proxy(local.globalData, globalDataAccessHandler);
};

const chalkUpError = (name: PageName, error: Error) : void => {
  // Show generate script errors nicely.
  console.log("\nScript Error: " + chalk.bgBlack.red(name));
  if (error.message) {
    console.log(chalk.bgBlack.white(error.message));
  }
  if (typeof error == "string") {
    console.log(chalk.bgBlack.white(error));
  }
  if (error.stack) {
    try {
      const lines = error.stack.split("\n");
      const errorLine = Number(lines[0].split(":")[1]) - 1;
      const script = local.generateScripts[name].split("\n");
      script.forEach((line, index) => {
        if (index == errorLine) {
          console.log(chalk.bgBlack.red(line));
        } else {
          console.log(chalk.bgBlack.blue(line));
        }
      });
    } catch {
      console.log(chalk.red(error.stack));
    }
  }
};

function scriptLogger(name: PageName) : void {
  // Format log messages from generate script.
  const args = Array.from(arguments);
  console.log(
    chalk.yellow(name) + chalk.white(": " + args[1]),
    ...args.slice(2)
  );
}

const writeEntryScript = (script: string, url: string) : void => {
  const writePath = "./" + fspath.join(outputDir, "/", url);
  if (!fs.existsSync(writePath)) {
    mkdirSyncSafe(writePath, { recursive: true });
  }
  let name = "index.js";
  if (url == "/") name = "main.js";
  const p = fspath.resolve(writePath + "/" + name);
  local.state["entry"][url] = p;
  writeFileSafe(p, script, (err: NodeJS.ErrnoException | null):void => {
    if (err) {
      console.log(chalk.red("Error writting: " + p));
    } else {
      console.log(chalk.magenta("Wrote: " + p));
    }
  });
};

/// -----------------------------------------------------------------------------
/// Core
/// -----------------------------------------------------------------------------
const processGeneratorResponse = (response: GeneratorResponse, name: PageName, cacheName: string) : void => {
  // Deal with returned promise such as cache, site data, and dependency requests
  if (response.cache) {
    // page is requesting to update its cache
    local.cache[cacheName] = response.cache;
    storeCache();
  }
  if (response.siteFiles) {
    // page is asking to create a json file in the output directory
    const siteFiles = response.siteFiles;

    for (const file in siteFiles) {
      const p = fspath.resolve("./" + fspath.join(outputDir + "/" + file));
      const writePath = fspath.parse(p).dir;
      if (!fs.existsSync(writePath)) {
        mkdirSyncSafe(writePath, { recursive: true });
      }
      local.state["json"][name] = p;
      let writeData;
      if (
        typeof siteFiles[file] === "string" ||
        siteFiles[file] instanceof String
      ) {
        writeData = siteFiles[file];
      } else {
        writeData = JSON.stringify(siteFiles[file]);
      }
      writeFileSafe(p, writeData, (err: NodeJS.ErrnoException | null):void => {
        if (err) {
          console.log(
            chalk.red("Error writing template's siteFiles '" + name + "': '" + p)
          );
        } else {
          console.log(chalk.cyanBright("Wrote: " + p));
        }
      });
    }
  }
  if (response.watchFiles) {
    response.watchFiles.forEach((file: Path) => {
      const dep = fspath.resolve(file);
      if (!local.pathDepTree[dep]) {
        local.pathDepTree[dep] = {};
      }
      local.pathDepTree[dep][name] = true;
    });
  }
  if (response.watchGlobs) {
    response.watchGlobs.forEach((glob: string) => {
      if (!local.wildDepTree[glob]) {
        local.wildDepTree[glob] = {};
      }
      local.wildDepTree[glob][name] = true;
    });
  }
};

const renderTemplate = (template: TemplateName, path: string, data: PageData) : Promise<TemplateName> => {
  // recursively render a template to disk
  return new Promise(function (resolve, reject) {
    try {
      const renderInclude = function (dependency: TemplateName, passedData?: PageData) : string {
        if (dependency == "_body") {
          dependency = template;
          // pass along the data from whoever was wrapped by this
          passedData = {
            ...(passedData || {}),
            ...data,
            global: getGlobalDataAccessProxy(template),
          };
        }
        if (!local.templateDepTree[dependency]) {
          local.templateDepTree[dependency] = {};
        }
        local.templateDepTree[dependency][template] = true;
        return local.templates[dependency](passedData, undefined, renderInclude);
      };
      let html;
      if (local.frontMatter[template].wrapper) {
        // render wrapper where _body gets redirected back to this template.
        html = local.templates[local.frontMatter[template].wrapper as string](
          data,
          undefined,
          renderInclude
        );
      } else {
        html = local.templates[template](data, undefined, renderInclude);
      }
      const writePath = "./" + fspath.join(outputDir, "/", path);
      if (!fs.existsSync(writePath)) {
        mkdirSyncSafe(writePath, { recursive: true });
      }
      const p = fspath.resolve(writePath + "/index.html");
      local.state["html"][path] = p;
      writeFileSafe(p, html,  (err: NodeJS.ErrnoException | null):void => {
        if (err) {
          reject(template);
        } else {
          console.log(chalk.magenta("Wrote: " + p));
          resolve(template);
        }
      });
    } catch (error) {
      console.log(chalk.red.bold(`${template}: ${path}`));
      console.log(chalk.red(error));
      reject(template);
    }
  });
};

const generatePages = () : Promise<void> => {
  // Generate all pending pages
  // running generate scripts if specified,
  // rendering templates to disk.
  return new Promise(function (resolve, reject) {
    let toGenerate = Object.values(local.toGenerate);

    let toRender = toGenerate.length;

    const checkDone = (pageName:PageName, path:string = "") => {
      toRender--;
      delete local.toGenerate[pageName]; // mark completed
      if (path && local.entryScripts[pageName] != undefined) {
        writeEntryScript(local.entryScripts[pageName], path);
      }
      if (toRender == 0) {
        resolve();
      }
    };

    if (toGenerate.length == 0) {
      console.log(chalk.yellow("\nNothing to do.  Will wait for changes."));
      resolve();
      return;
    }

    toGenerate.forEach((generateData: ToGenerateData) => {
      if (local.generateScripts[generateData.name]) {
        // found a generate script -> run it
        const generateSuccess = (response: GeneratorResponse) => {
          // callback on generate script complete
          const generate = response.generate;
          if (!generate) {
            throw new Error(
              "No data returned by generate function: " + generateData.name
            );
          }
          processGeneratorResponse(response, generateData.name, "_" + generateData.name);
          let pages = generate;
          if (!Array.isArray(generate)) {
            pages = [generate];
          } else {
            toRender += pages.length - 1; // account for extra pages
          }
          pages.forEach((generatePageRequest: PageGenerateRequest) => {
            const data = {
              ...local.frontMatter[generateData.name],
              global: getGlobalDataAccessProxy(generateData.name),
              ...generatePageRequest.data,
            };
            renderTemplate(generateData.name, generatePageRequest.path, data)
              .then(() => {
                checkDone(generateData.name, generatePageRequest.path);
              })
              .catch((error) => {
                console.log(chalk.red.bold(`${generateData.name}: ${generatePageRequest.path}`));
                console.log(chalk.red(error));
                checkDone(generateData.name);
              });
          });
        };
        const generateError = (error: Error) => {
          chalkUpError(generateData.name, error);
          checkDone(generateData.name);
        };
        if (!local.cache["_" + generateData.name]) {
          local.cache["_" + generateData.name] = {};
        }

        const inputs = {
          triggeredBy: generateData.triggeredBy,
          frontMatter: local.frontMatter[generateData.name].attributes,
        }

        const code =
          "((require, resolve, reject, inputs, global, getDataFileNames, cache, log) =>  {" +
          local.generateScripts[generateData.name] +
          "})";
        expireCache();
        try {
          vm.runInThisContext(code)(
            require,
            generateSuccess,
            generateError,
            inputs,
            getGlobalDataAccessProxy(generateData.name),
            getDataFileNames,
            local.cache["_" + generateData.name],
            scriptLogger.bind(null, generateData.name)
          );
        } catch (error: unknown) {
          if (error instanceof Error) {
            generateError(error);
          } else {
            console.log("Unknown error "+error)
            generateError(new Error("unknown error"))
          }
        }
      }
      else if (generateData.generate) {
        const data = {
          ...local.frontMatter[generateData.name],
          global: getGlobalDataAccessProxy(generateData.name),
        };
        renderTemplate(generateData.name, generateData.generate, data)
          .then(() => {
            checkDone(generateData.name, generateData.generate);
          })
          .catch((error) => {
            console.log(chalk.red.bold(`${generateData.name}: ${generateData.generate}`));
            console.log(chalk.red(error));
            checkDone(generateData.name, generateData.generate);
          });
      }
    });
  });
};

const compileTemplate = (source: string, name: TemplateName) : void => {
  // Pre compile ejs template
  const fn = ejs.compile(source, { client: true });
  local.templates[name] = fn;
};

const cueGeneration = (name: PageName, triggeredBy = ""): void=> {
  // Mark a page ready for generation.
  const generate = local.frontMatter[name].generate as string;
  local.toGenerate[name] = {
    name: name,
    generate: generate,
    triggeredBy: triggeredBy,
  };
};

const processScript = (source: string, name: PageName): boolean => {
  // Generate scripts are stored,
  // site scripts are state to output.
  if (source.startsWith(SCRIPT_GENERATE)) {
    // add generate source to build map
    const stripped = source.slice(SCRIPT_GENERATE_LENGTH, -END_SCRIPT_LENGTH);
    local.generateScripts[name] = stripped;
    return true;
  }
  if (source.startsWith(SCRIPT_ENTRY)) {
    // add entry source to build map
    const stripped = source.slice(SCRIPT_ENTRY_LENGTH, -END_SCRIPT_LENGTH);
    local.entryScripts[name] = stripped;
    return true;
  } else if (source.startsWith(SCRIPT_LIB)) {
    // create <file>.js for any component source in output/js
    const stripped = source.slice(SCRIPT_LIB_LENGTH, -END_SCRIPT_LENGTH);
    const parsed = fspath.parse(name);
    const dir = parsed.dir;
    if (!fs.existsSync(outputDir + libDir + "/" + dir)) {
      mkdirSyncSafe(outputDir + libDir + "/" + dir, { recursive: true });
    }
    const p = fspath.resolve(outputDir + libDir + "/" + name + ".js");
    local.state["lib"][name] = p;
    writeFileSafe(p, stripped,  (err: NodeJS.ErrnoException | null):void => {
      if (err) {
        console.log(chalk.red(err));
      }
      console.log(chalk.cyan("Wrote: " + p));
    });
    return true;
  }
  return false;
};

const testTemplate = (file: Path) : string | undefined => {
  // Make sure extension is html and format the name the way we like it.
  const parsed = fspath.parse(file);
  const rel = fspath.relative(sourceDir + TEMPLATE_DIR, parsed.dir);
  const name = rel + (rel ? "/" : "") + parsed.name;
  const ext = fspath.parse(file).ext;
  if (ext == ".ejs") {
    return name;
  }
  return undefined;
};

const processTemplateFilesPromise = (file : string|undefined = undefined) : Promise<string[]> => {
  // Process all template files found under input director,
  // or a single file if we had been watching it for changes.
  return new Promise(function (resolve, reject) {
    let list:string[] = [];
    if (file == undefined) {
      try {
        list = getAllFiles(sourceDir + TEMPLATE_DIR);
      } catch (error) {
        console.log(chalk.red("Could not scan " + sourceDir + TEMPLATE_DIR));
      }
    } else {
      list = [file];
    }

    const names:string[] = [];

    let pending = list.length;
    const checkDone = (name?: string) => {
      if (name) {
        names.push(name);
      }
      pending--;
      if (pending <= 0) {
        resolve(names);
      }
    };

    if (list.length == 0) {
      resolve([]);
      return;
    }

    console.log(chalk.green(`Processing ${pending} input files.`));

    list.forEach((file: Path) => {
      const name = testTemplate(file);
      if (name) {
        fs.readFile(file, "utf8", function (err, data) {
          if (err) reject(err);
          const content = fm(data);
          local.frontMatter[name] = content.attributes as FrontMatterEntries;
          const body = content.body;
          const remove: [number,number][] = [];
          const replacer = (match: string, offset: number) => {
            const used = processScript(match, name);
            if (used) {
              const first = offset;
              const second = offset + match.length;
              remove.push([first, second]);
            }
            return "";
          };
          body.replace(EXTRACT_SCRIPT, replacer);
          // piece together template without scripts
          let template = "";
          let index = 0;
          if (remove.length > 0) {
            remove.forEach((script) => {
              template += body.substr(index, script[0] - index);
              index = script[1];
            });
          } else template = body;
          compileTemplate(template.trim(), name);
          cueGeneration(name);
          checkDone(name);
        });
      } else {
        console.log(
          chalk.yellow(
            "Warning, non html file found in templates folders: " + file
          )
        );
        checkDone();
      }
    });
  });
};

const processGeneratePre = () : Promise<void> => {
  // preGenerate.js creates global data for all generate scripts.
  // If changed via watcher, make sure to re-generate
  // any pages that asked to depend on global.
  return new Promise(function (resolve, reject) {
    const generateSuccess = (response: GeneratorResponse) => {
      local.globalData = response.global;
      processGeneratorResponse(
        response,
        PRE_GENERATE_JS,
        PRE_GENERATE_NAME
      );
      resolve();
    };
    const g = sourceDir + "/" + PRE_GENERATE_JS;
    const generateError = (error: Error) => {
      chalkUpError(PRE_GENERATE_NAME, error);
      reject(error);
    };
    if (fs.existsSync(g)) {
      const script = fs.readFileSync(g, "utf8");
      if (!local.cache[PRE_GENERATE_NAME]) {
        local.cache[PRE_GENERATE_NAME] = {};
      }
      const code =
        "((require, resolve, reject, cache, log) =>  {" + script + "})";
      try {
        vm.runInThisContext(code)(
          require,
          generateSuccess,
          generateError,
          local.cache[PRE_GENERATE_NAME],
          scriptLogger.bind(null, PRE_GENERATE_NAME)
        );
      } catch (error) {
        console.log(chalk.red(error));
        reject(error);
      }
    } else {
      resolve(); // no global data
    }
  });
};

const processGeneratePost = () : Promise<void> => {
  // postGenerate.js has access what we wrote during site generation
  return new Promise(function (resolve, reject) {
    const generateSuccess = (response: GeneratorResponse) => {
      processGeneratorResponse(
        response,
        POST_GENERATE_JS,
        POST_GENERATE_NAME
      );
      resolve();
    };
    const g = sourceDir + "/" + POST_GENERATE_JS;
    const generateError = (error: Error) => {
      chalkUpError(POST_GENERATE_NAME, error);
      reject(error);
    };
    if (fs.existsSync(g)) {
      const script = fs.readFileSync(g, "utf8");
      const code =
        "((require, resolve, reject, state, log) =>  {" + script + "})";
      try {
        vm.runInThisContext(code)(
          require,
          generateSuccess,
          generateError,
          local.state,
          scriptLogger.bind(null, POST_GENERATE_NAME)
        );
      } catch (error) {
        console.log(chalk.red(error));
        reject(error);
      }
    } else {
      resolve(); // no global data
    }
  });
};

const updateDeps = (dependencies: Dependencies, dependency = "") : void => {
  for (const pageName in dependencies) {
    // tell the generator that this data file
    // has changed in case it can be efficient
    cueGeneration(pageName, dependency);
  }
  generatePages()
    .then(() => {
      console.log(chalk.green("Dependency Updates Complete."));
    })
    .catch((error) => {
      console.log(chalk.red("Dependency Updates Failed."));
      console.log(chalk.red(error));
    });
};

const updateDataDeps = (path: Path) : void => {
  let dependencies;
  // intelligently find the dep
  // first look for direct match:
  dependencies = local.pathDepTree[path];
  if (dependencies) {
    console.log(chalk.green("Update Triggered by: " + path));
  } else if (!dependencies) {
    // check for wildcard match
    const wildDeps = Object.keys(local.wildDepTree);
    for (let pattern of wildDeps) {
      if (micromatch.isMatch(path, "**/" + pattern)) {
        dependencies = local.wildDepTree[pattern];
        console.log(chalk.green("Update Triggered by: " + path));
        break;
      }
    }
  }
  if (dependencies) {
    updateDeps(dependencies, path);
  } else {
    console.log(chalk.yellow("Info: No dependencies to update for " + path));
  }
};

const updateTemplateDeps = (templateName: TemplateName) => {
  // when a template updates, we need to check its dependencies and also trigger its own
  // generation if it is a page maker
  const deps = { ...(local.templateDepTree[templateName] || {}), [templateName]: true };
  console.log(chalk.green("Update Triggered by: " + templateName));
  updateDeps(deps);
};

const updatGlobalDeps = () : void => {
  console.log(chalk.green("Update Triggered by preGenerate.js change."));
  updateDeps(local.globalDeps);
};

// -----------------------------------------------------------------------------
// Start of program
// -----------------------------------------------------------------------------
// -  recurse through all html files in src.
//    - add template to template map
//    - add build script to build map
//    - if generate, add to generate list
// -  create reverse dependency tree
// -  render generate list to output/<generate url>
// -  watch files
//    - find in dependency tree and rebuild whatever is necessary
/*
program
  .command("mark-done")
  .description("Mark commands done")
  .option(
    "-t, --tasks <tasks...>",
    "The tasks to mark done. If not specified, all tasks will be marked done."
  )
  .action(markDone);

program.parse();
*/

if (clearOutDir) {
  if (fs.existsSync(outputDir)) {
    fs.rmdirSync(outputDir, { recursive: true });
  }
}

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

console.log(chalk.black.bgWhite.bold("\n Air", chalk.white.bgBlue(" Fry \n")));
console.log(chalk.blueBright("Version 0.0.1\n"));

loadCache();

// step 1:  process global.js
processGeneratePre()
  .then(() => {
    // step 2. process existing src files
    return processTemplateFilesPromise();
  })
  .then(() => {
    // step 3. wait until first batch page generation
    return generatePages();
  })
  .then(() => {
    // step 3. wait until first batch page generation
    return processGeneratePost();
  })
  .then(() => {
    // step 3. watch src directory

    const watcher = chokidar.watch(sourceDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    const getKind = (p: Path) => {
      const checks = [
        {
          kind: "template",
          prefix: fspath.join(sourceDir, TEMPLATE_DIR),
        },
        {
          kind: "data",
          prefix: fspath.join(sourceDir, DATA_DIR),
        },
        {
          kind: PRE_GENERATE_NAME,
          prefix: fspath.join(sourceDir, PRE_GENERATE_JS),
        },
        {
          kind: POST_GENERATE_NAME,
          prefix: fspath.join(sourceDir, POST_GENERATE_JS),
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
      .on("add", (p: Path) => {
        const check = getKind(p);
        if (check.kind == PRE_GENERATE_NAME) {
          updatGlobalDeps();
        } else if (check.kind == "template") {
          processTemplateFilesPromise(p).then(() => {
            console.log(chalk.green("New file processed: " + p));
          });
        } else if (check.kind == "data") {
          // if anyone was watching the file or entire data directory
          const dataFileName = fspath.resolve(
            sourceDir + DATA_DIR + "/" + check.name
          );
          updateDataDeps(dataFileName);
        }
      })
      .on("change", (p) => {
        const check = getKind(p);
        if (check.kind == PRE_GENERATE_NAME) {
          processGeneratePre()
            .then(() => {
              console.log(
                chalk.green("Pre Generate JS updated -- updating deps")
              );
              updatGlobalDeps();
            })
            .catch((error) => {
              console.log(chalk.red("Pre Generate JS update error: "));
              console.log(chalk.red(error));
            });
        } else if (check.kind == POST_GENERATE_NAME) {
          processGeneratePost()
            .then(() => {
              console.log(chalk.green("Post Generate JS updated"));
            })
            .catch((error) => {
              console.log(chalk.red("Post Generate JS update error: "));
              console.log(chalk.red(error));
            });
        } else if (check.kind == "template") {
          // step 1. update the template itself,
          processTemplateFilesPromise(getTemplateFileName(check.name))
            .then((updateList) => {
              console.log(chalk.green("Template Updated: " + p));
              // render it:
              // step 2. ... then any other templates depending on it
              updateTemplateDeps(updateList[0]);
            })
            .catch((error) => {
              console.log(chalk.red("Template update error: "));
              console.log(chalk.red(error));
            });
        } else if (check.kind == "data") {
          const dataFileName = fspath.resolve(
            sourceDir + DATA_DIR + "/" + check.name
          );
          updateDataDeps(dataFileName);
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
