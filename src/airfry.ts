import ejs from "ejs";
import vm from "vm";
import fs from "fs";
import fspath from "path";
import fm from "front-matter";
import chalk from "chalk";
import micromatch from "micromatch";

import { getAllFiles, isRelative, Pinger } from "./shared";

export const PRE_GENERATE_JS = "preGenerate.js";
export const POST_GENERATE_JS = "postGenerate.js";
export const PRE_GENERATE_NAME = "PRE_GENERATE";
export const POST_GENERATE_NAME = "POST_GENERATE";

const libDir = "/js";

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
  [key: string]: unknown;
};

type FrontMatter = {
  [key: PageName]: FrontMatterEntries;
};

type CompiledTemplate = {
  [key: PageName]: ejs.ClientFunction;
};

type ToGenerateData = {
  name: PageName;
  generate: string;
  triggeredBy: string;
};

type ToGenerate = {
  [key: string]: ToGenerateData;
};

type PageData = {
  [key: string]: unknown;
};

type CacheItem = {
  expires: number;
  data: PageData;
};

type CacheData = {
  [key: string]: CacheItem;
};

type Cache = {
  [key: PageName]: CacheData;
};

type FilesWritten = {
  [key: string]: Path;
};

type GeneratorDataOutput = {
  [key: PageName]: { [key: string]: PageData };
};

type OutputData = {
  html: FilesWritten;
  entry: FilesWritten;
  lib: FilesWritten;
  json: FilesWritten;
  outData: GeneratorDataOutput;
};

type PageGenerateRequest = {
  path: string;
  data: PageData;
};

type GeneratorResponse = {
  cache: CacheData;
  siteFiles: { [key: Path]: unknown };
  generate: PageGenerateRequest[] | PageGenerateRequest | undefined;
  watchFiles: Path[];
  watchGlobs: string[];
  outData: GeneratorDataOutput;
  global: PageData; // only valid from pregenerat
};

type AirFryData = {
  generateScripts: Script;
  entryScripts: Script;
  templateDepTree: DependencyTree;
  pathDepTree: DependencyTree;
  wildDepTree: DependencyTree;
  globalDeps: Dependencies;
  frontMatter: FrontMatter;
  templates: CompiledTemplate;
  toGenerate: ToGenerate;
  globalData: PageData;
  cache: Cache;
  outputData: OutputData;
};

type fsFunc = (...args: any[]) => unknown;

function safeOutputCheck(
  func: fsFunc,
  outPath: string,
  path: string,
  ...args: unknown[]
) {
  if (!isRelative(outPath, path)) {
    throw "Trying to write " + path + " which is outside of " + outPath;
  }
  func(path, ...args);
}

export class AirFry {
  readonly inputDir: string;
  readonly dataDir: string;
  readonly outputDir: string;
  readonly cacheDir: string;
  readonly outPath: string;

  constructor(
    inputDir: string,
    dataDir: string,
    outputDir: string,
    cacheDir: string
  ) {
    this.inputDir = inputDir;
    this.dataDir = dataDir;
    this.outputDir = outputDir;
    this.cacheDir = cacheDir;
    this.outPath = fspath.resolve("./" + this.outputDir);
    this.loadCache();
  }

  state: AirFryData = {
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
    outputData: {
      html: {},
      entry: {},
      lib: {},
      json: {},
      outData: {},
    },
  };

  protected writeFileSafe(path: string, ...args: unknown[]) {
    safeOutputCheck(fs.writeFile, this.outputDir, path, ...args);
  }

  protected mkdirSyncSafe(path: string, ...args: unknown[]) {
    safeOutputCheck(fs.mkdirSync, this.outputDir, path, ...args);
  }

  /// ----------------------------------------------------------------------------
  /// Safety to prevent user from accidently
  /// writing files outside the output directory
  /// ----------------------------------------------------------------------------
  protected getDataFileNames(
    source: string,
    globList?: string | string[]
  ): string[] {
    const resData = fspath.resolve(this.dataDir);
    let files = getAllFiles(resData);

    if (globList) {
      let fixedGlobs: string[];
      if (!Array.isArray(globList)) {
        fixedGlobs = [globList];
      } else {
        fixedGlobs = globList;
      }
      fixedGlobs = fixedGlobs.map((glob) => {
        return resData + "/" + glob;
      });
      files = micromatch(files, fixedGlobs);
    }
    if (files.length == 0) {
      console.log(
        chalk.red(
          "Warning, " +
            source +
            ".ejs requested data files but none were found at " +
            this.dataDir
        )
      );
    }
    return files;
  }

  public getTemplateFileName(file: Path): string {
    const p = fspath.join("./", this.inputDir, "/", file);
    return p;
  }

  /// -----------------------------------------------------------------------------
  /// Caching
  /// -----------------------------------------------------------------------------
  protected expireCache(): void {
    for (const pageName in this.state.cache) {
      const pageCache = this.state.cache[pageName];
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
  }
  protected loadCache(): void {
    if (fs.existsSync(this.cacheDir + "/cache.json")) {
      let rawdata = fs.readFileSync(this.cacheDir + "/cache.json");
      if (rawdata && rawdata.length > 0) {
        this.state.cache = JSON.parse(rawdata.toString());
      }
    }
  }

  // call before exiting
  public storeCache(): void {
    let data = JSON.stringify(this.state.cache);
    if (data) {
      if (!fs.existsSync(this.cacheDir)) {
        console.log(chalk.green("Making cache dir: " + this.cacheDir));
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      console.log(chalk.green("Writing cache"));
      fs.writeFileSync(this.cacheDir + "/cache.json", data);
    }
  }

  /// -----------------------------------------------------------------------------
  /// Helpers
  /// -----------------------------------------------------------------------------
  protected getGlobalDataAccessProxy(name: PageName): typeof Proxy {
    // a proxy to detect access to global data from scripts
    const state = this.state;
    const globalDataAccessHandler = {
      get: function (...args: any) {
        // access to global deps was detected
        if (!state.globalData[args[1] as string]) {
          throw "Accessing undefined global data Element: " + args[1];
        }
        state.globalDeps[name] = true;
        return Reflect.get.apply(null, args);
      },
    };
    return new Proxy(state.globalData, globalDataAccessHandler);
  }

  protected chalkUpError(name: PageName, error: Error): void {
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
        const script = this.state.generateScripts[name].split("\n");
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
  }

  protected scriptLogger(name: PageName): void {
    // Format log messages from generate script.
    const args = Array.from(arguments);
    console.log(
      chalk.yellow(name) + chalk.white(": " + args[1]),
      ...args.slice(2)
    );
  }

  protected writeEntryScript(script: string, url: string): void {
    const writePath = "./" + fspath.join(this.outputDir, "/", url);
    if (!fs.existsSync(writePath)) {
      this.mkdirSyncSafe(writePath, { recursive: true });
    }
    let name = "index.js";
    if (url == "/") name = "main.js";
    const p = fspath.resolve(writePath + "/" + name);
    this.state.outputData.entry[url] = p;
    this.writeFileSafe(p, script, (err: NodeJS.ErrnoException | null): void => {
      if (err) {
        console.log(chalk.red("Error writting: " + p));
      } else {
        console.log(chalk.magenta("Wrote: " + p));
      }
    });
  }

  /// -----------------------------------------------------------------------------
  /// processGeneratorResponse
  ///
  /// Process what was resolved from generator scripts.
  /// Deal with returned promise such as cache, site data, and dependency requests
  /// -----------------------------------------------------------------------------
  protected processGeneratorResponse(
    response: GeneratorResponse,
    name: PageName,
    cacheName: string
  ): void {
    if (response.cache) {
      // page is requesting to update its cache
      this.state.cache[cacheName] = response.cache;
    }
    if (response.outData) {
      this.state.outputData.outData[name] = response.outData;
    }
    if (response.siteFiles) {
      // page is asking to create a json file in the output directory
      const siteFiles = response.siteFiles;

      for (const file in siteFiles) {
        const p = fspath.resolve(
          "./" + fspath.join(this.outputDir + "/" + file)
        );
        const writePath = fspath.parse(p).dir;
        if (!fs.existsSync(writePath)) {
          this.mkdirSyncSafe(writePath, { recursive: true });
        }
        this.state.outputData.json[name] = p;
        let writeData;
        if (
          typeof siteFiles[file] === "string" ||
          siteFiles[file] instanceof String
        ) {
          writeData = siteFiles[file];
        } else {
          writeData = JSON.stringify(siteFiles[file]);
        }
        this.writeFileSafe(
          p,
          writeData,
          (err: NodeJS.ErrnoException | null): void => {
            if (err) {
              console.log(
                chalk.red(
                  "Error writing template's siteFiles '" + name + "': '" + p
                )
              );
            } else {
              console.log(chalk.cyanBright("Wrote: " + p));
            }
          }
        );
      }
    }
    if (response.watchFiles) {
      response.watchFiles.forEach((file: Path) => {
        const dep = fspath.resolve(file);
        if (!this.state.pathDepTree[dep]) {
          this.state.pathDepTree[dep] = {};
        }
        this.state.pathDepTree[dep][name] = true;
      });
    }
    if (response.watchGlobs) {
      response.watchGlobs.forEach((glob: string) => {
        if (!this.state.wildDepTree[glob]) {
          this.state.wildDepTree[glob] = {};
        }
        this.state.wildDepTree[glob][name] = true;
      });
    }
  }

  /// -----------------------------------------------------------------------------
  /// renderTemplate
  ///
  /// recursively render a template and all its children to disk
  /// -----------------------------------------------------------------------------
  protected renderTemplate(
    template: TemplateName,
    path: string,
    data: PageData
  ): Promise<TemplateName> {
    const me = this;
    let current = template;
    return new Promise(function (resolve, reject) {
      try {
        const renderInclude = function (
          dependency: TemplateName,
          passedData?: PageData
        ): string {
          current = dependency;
          if (dependency == "_body") {
            dependency = template;
          }
          if (!me.state.templateDepTree[dependency]) {
            me.state.templateDepTree[dependency] = {};
          }
          me.state.templateDepTree[dependency][template] = true;
          return me.state.templates[dependency](
            {
              ...(passedData || {}),
              ...data,
            },
            undefined,
            renderInclude
          );
        };
        let html;
        if (me.state.frontMatter[template].wrapper) {
          current = me.state.frontMatter[template].wrapper as string;
          // render wrapper where _body gets redirected back to this template.
          html = me.state.templates[current](data, undefined, renderInclude);
        } else {
          html = me.state.templates[template](data, undefined, renderInclude);
        }
        const writePath = "./" + fspath.join(me.outputDir, "/", path);
        if (!fs.existsSync(writePath)) {
          me.mkdirSyncSafe(writePath, { recursive: true });
        }
        const p = fspath.resolve(writePath + "/index.html");
        me.state.outputData.html[path] = p;
        me.writeFileSafe(p, html, (err: NodeJS.ErrnoException | null): void => {
          if (err) {
            reject(template);
          } else {
            console.log(chalk.magenta("Wrote: " + p));
            resolve(template);
          }
        });
      } catch (error) {
        console.log(
          chalk.red.bold(
            `Error rendering page: ${template}, template: ${current}, path: ${path}`
          )
        );
        console.log(chalk.red(error));
        reject(template);
      }
    });
  }

  /// -----------------------------------------------------------------------------
  /// generatePages
  ///
  /// Generate all cued pages
  /// running generate scripts if specified,
  /// rendering templates to disk.
  /// -----------------------------------------------------------------------------
  public generatePages(): Promise<void> {
    const me = this;
    return new Promise(function (resolve, _) {
      let toGenerate = Object.values(me.state.toGenerate);

      let toRender = toGenerate.length;

      const checkDone = (pageName: PageName, path: string = "") => {
        toRender--;
        delete me.state.toGenerate[pageName]; // mark completed
        if (path && me.state.entryScripts[pageName] != undefined) {
          me.writeEntryScript(me.state.entryScripts[pageName], path);
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

      const generateSimple = (name: string, path: string) => {
        // Generate a page that does not have a generate script
        // or returns no page creation data from it
        const data = {
          ...me.state.frontMatter[name],
          global: me.getGlobalDataAccessProxy(name),
        };
        me.renderTemplate(name, path, data)
          .then(() => {
            checkDone(name, path);
          })
          .catch(() => {
            checkDone(name, path);
          });
      };

      toGenerate.forEach((generateData: ToGenerateData) => {
        if (me.state.generateScripts[generateData.name]) {
          let pinger = new Pinger(
            generateData.name,
            (id: string) => {
              console.log(
                chalk.yellowBright(
                  "Waiting for generator to call resolve: " + id
                )
              );
            },
            3000
          );
          // found a generate script -> run it
          const generateSuccess = (response: GeneratorResponse) => {
            pinger.done();
            // callback on generate script complete
            const generate = response.generate;
            me.processGeneratorResponse(
              response,
              generateData.name,
              "_" + generateData.name
            );
            let pages: PageGenerateRequest[];
            if (!generate) {
              // script didn't specify anything for generate
              // use front matter only
              generateSimple(generateData.name, generateData.generate);
              return;
            } else if (!Array.isArray(generate)) {
              // script specified a single page to generate
              pages = [generate as PageGenerateRequest];
            } else {
              // script specified an array of pages to generate
              pages = generate;
              toRender += pages.length - 1; // account for extra pages
            }
            const pathStars = (generateData.generate.match(/\*/g) || []).length;
            if (pathStars > 1) {
              throw new Error(
                "Generate paths can only include a single path replacement *" +
                  generateData.name
              );
            } else if (pathStars == 0) {
              throw new Error(
                "Generate paths must include a path replacement * when generating 1 or more pages from data." +
                  generateData.name
              );
            } else {
              pages.forEach((generatePageRequest: PageGenerateRequest) => {
                const data = {
                  ...me.state.frontMatter[generateData.name],
                  global: me.getGlobalDataAccessProxy(generateData.name),
                  ...generatePageRequest.data,
                };
                const starReplacedPath = generateData.generate.replace(
                  /\*/,
                  generatePageRequest.path
                );
                me.renderTemplate(generateData.name, starReplacedPath, data)
                  .then(() => {
                    checkDone(generateData.name, starReplacedPath);
                  })
                  .catch(() => {
                    checkDone(generateData.name);
                  });
              });
            }
          };
          const generateError = (error: Error) => {
            pinger.done();
            me.chalkUpError(generateData.name, error);
            checkDone(generateData.name);
          };
          if (!me.state.cache["_" + generateData.name]) {
            me.state.cache["_" + generateData.name] = {};
          }
          const inputs = {
            triggeredBy: generateData.triggeredBy,
            frontMatter: me.state.frontMatter[generateData.name].attributes,
          };
          const code =
            "((require, resolve, reject, inputs, global, getDataFileNames, cache, log) =>  {" +
            me.state.generateScripts[generateData.name] +
            "})";
          me.expireCache();
          try {
            vm.runInThisContext(code)(
              require,
              generateSuccess,
              generateError,
              inputs,
              me.getGlobalDataAccessProxy(generateData.name),
              me.getDataFileNames.bind(me, generateData.name),
              me.state.cache["_" + generateData.name],
              me.scriptLogger.bind(null, generateData.name)
            );
          } catch (error: unknown) {
            if (error instanceof Error) {
              generateError(error);
            } else {
              console.log(chalk.red("Unknown error " + error));
              generateError(new Error("unknown error"));
            }
          }
        } else if (generateData.generate) {
          generateSimple(generateData.name, generateData.generate);
        }
      });
    });
  }

  /// -----------------------------------------------------------------------------
  /// compileTemplate
  ///
  /// Pre-compile an EJS template
  /// -----------------------------------------------------------------------------
  protected compileTemplate(source: string, name: TemplateName): void {
    // Pre compile ejs template
    const fn = ejs.compile(source, { client: true });
    this.state.templates[name] = fn;
  }

  /// -----------------------------------------------------------------------------
  /// cueGeneration
  ///
  /// Mark a page to be generated
  /// -----------------------------------------------------------------------------
  protected cueGeneration(name: PageName, triggeredBy = ""): void {
    const generate = this.state.frontMatter[name].generate as string;
    if (generate) {
      this.state.toGenerate[name] = {
        name: name,
        generate: generate,
        triggeredBy: triggeredBy,
      };
    }
  }

  /// -----------------------------------------------------------------------------
  /// processScript
  ///
  /// Process a script tag found in a template file.
  /// - Generate scripts are stored,
  /// - site scripts are state to output.
  /// -----------------------------------------------------------------------------
  protected processScript(source: string, name: PageName): boolean {
    if (source.startsWith(SCRIPT_GENERATE)) {
      // add generate source to build map
      const stripped = source.slice(SCRIPT_GENERATE_LENGTH, -END_SCRIPT_LENGTH);
      this.state.generateScripts[name] = stripped;
      return true;
    }
    if (source.startsWith(SCRIPT_ENTRY)) {
      // add entry source to build map
      const stripped = source.slice(SCRIPT_ENTRY_LENGTH, -END_SCRIPT_LENGTH);
      this.state.entryScripts[name] = stripped;
      return true;
    } else if (source.startsWith(SCRIPT_LIB)) {
      // create <file>.js for any component source in output/js
      const stripped = source.slice(SCRIPT_LIB_LENGTH, -END_SCRIPT_LENGTH);
      const parsed = fspath.parse(name);
      const dir = parsed.dir;
      if (!fs.existsSync(this.outputDir + libDir + "/" + dir)) {
        this.mkdirSyncSafe(this.outputDir + libDir + "/" + dir, {
          recursive: true,
        });
      }
      const p = fspath.resolve(this.outputDir + libDir + "/" + name + ".js");
      this.state.outputData.lib[name] = p;
      this.writeFileSafe(
        p,
        stripped,
        (err: NodeJS.ErrnoException | null): void => {
          if (err) {
            console.log(chalk.red(err));
          }
          console.log(chalk.cyan("Wrote: " + p));
        }
      );
      return true;
    }
    return false;
  }

  /// -----------------------------------------------------------------------------
  /// testTemplate
  ///
  /// Make sure extension is ejs and format the name the way we like it.
  /// -----------------------------------------------------------------------------
  protected testTemplate(file: Path): string | undefined {
    const parsed = fspath.parse(file);
    const rel = fspath.relative(this.inputDir, parsed.dir);
    const name = rel + (rel ? "/" : "") + parsed.name;
    const ext = fspath.parse(file).ext;
    if (ext == ".ejs") {
      return name;
    }
    return undefined;
  }

  /// -----------------------------------------------------------------------------
  /// processTemplateFilesPromise
  ///
  /// Process all template files found under input directory,
  /// or a single file if we had been watching it for changes.
  /// -----------------------------------------------------------------------------
  public processTemplateFilesPromise(
    file: string | undefined = undefined
  ): Promise<string[]> {
    const me = this;

    return new Promise(function (resolve, reject) {
      let list: string[] = [];
      if (file == undefined) {
        try {
          list = getAllFiles(me.inputDir);
        } catch (error) {
          console.log(chalk.red("Could not scan " + me.inputDir));
        }
      } else {
        list = [file];
      }

      const names: string[] = [];

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
        const name = me.testTemplate(file);
        if (name) {
          fs.readFile(file, "utf8", function (err, data) {
            if (err) reject(err);
            const content = fm(data);
            me.state.frontMatter[name] =
              content.attributes as FrontMatterEntries;
            const body = content.body;
            const remove: [number, number][] = [];
            const replacer = (match: string, offset: number) => {
              const used = me.processScript(match, name);
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
            me.compileTemplate(template.trim(), name);
            me.cueGeneration(name);
            checkDone(name);
          });
        } else {
          checkDone();
        }
      });
    });
  }

  /// -----------------------------------------------------------------------------
  /// processPreGenerate
  ///
  /// preGenerate.js creates global data for all generate scripts.
  /// If changed via watcher, make sure to re-generate
  /// any pages that asked to depend on global.
  /// -----------------------------------------------------------------------------
  public processPreGenerate(): Promise<void> {
    const me = this;
    return new Promise(function (resolve, reject) {
      const g = me.inputDir + "/" + PRE_GENERATE_JS;
      if (fs.existsSync(g)) {
        let pinger = new Pinger(
          "preGenerate",
          (id: string) => {
            console.log(
              chalk.yellowBright("Waiting for generator to call resolve: " + id)
            );
          },
          3000
        );
        const generateSuccess = (response: GeneratorResponse) => {
          pinger.done();
          me.state.globalData = response.global;
          me.processGeneratorResponse(
            response,
            PRE_GENERATE_JS,
            PRE_GENERATE_NAME
          );
          resolve();
        };

        const generateError = (error: Error) => {
          pinger.done();
          me.chalkUpError(PRE_GENERATE_NAME, error);
          reject(error);
        };
        const script = fs.readFileSync(g, "utf8");
        if (!me.state.cache[PRE_GENERATE_NAME]) {
          me.state.cache[PRE_GENERATE_NAME] = {};
        }
        const code =
          "((require, resolve, reject, cache, log) =>  {" + script + "})";
        try {
          vm.runInThisContext(code)(
            require,
            generateSuccess,
            generateError,
            me.state.cache[PRE_GENERATE_NAME],
            me.scriptLogger.bind(null, PRE_GENERATE_NAME)
          );
        } catch (error) {
          console.log(chalk.red(error));
          reject(error);
        }
      } else {
        console.log(chalk.blue(PRE_GENERATE_JS + " not found, skipping."));
        resolve(); // no global data
      }
    });
  }

  /// -----------------------------------------------------------------------------
  /// processPostGenerate
  ///
  /// postGenerate.js has access what we wrote during site generation
  /// -----------------------------------------------------------------------------
  public processPostGenerate(): Promise<void> {
    const me = this;
    return new Promise(function (resolve, reject) {
      const g = me.inputDir + "/" + POST_GENERATE_JS;
      if (fs.existsSync(g)) {
        let pinger = new Pinger(
          "postGenerate",
          (id: string) => {
            console.log(
              chalk.yellowBright("Waiting for generator to call resolve: " + id)
            );
          },
          3000
        );
        const generateSuccess = (response: GeneratorResponse) => {
          pinger.done();
          me.processGeneratorResponse(
            response,
            POST_GENERATE_JS,
            POST_GENERATE_NAME
          );
          resolve();
        };
        const generateError = (error: Error) => {
          pinger.done();
          me.chalkUpError(POST_GENERATE_NAME, error);
          reject(error);
        };
        const script = fs.readFileSync(g, "utf8");
        const code =
          "((require, resolve, reject, output, log) =>  {" + script + "})";
        try {
          vm.runInThisContext(code)(
            require,
            generateSuccess,
            generateError,
            me.state.outputData,
            me.scriptLogger.bind(null, POST_GENERATE_NAME)
          );
        } catch (error) {
          console.log(chalk.red(error));
          reject(error);
        }
      } else {
        console.log(chalk.blue(POST_GENERATE_JS + " not found, skipping."));
        resolve(); // no global data
      }
    });
  }

  /// -----------------------------------------------------------------------------
  /// updateDeps
  ///
  /// When watching for file changes, we make sure to
  /// trigger any dependencies to regenerate.
  /// -----------------------------------------------------------------------------
  protected updateDeps(dependencies: Dependencies, dependency = ""): void {
    for (const pageName in dependencies) {
      // tell the generator that this data file
      // has changed in case it can be efficient
      this.cueGeneration(pageName, dependency);
    }
    this.generatePages()
      .then(() => {
        console.log(chalk.green("Dependency Updates Complete."));
      })
      .catch((error) => {
        console.log(chalk.red("Dependency Updates Failed."));
        console.log(chalk.red(error));
      });
  }

  /// -----------------------------------------------------------------------------
  /// updateDataDeps
  ///
  /// It's up to generator scripts to tell us which datafiles they'd like to watch
  /// -----------------------------------------------------------------------------
  updateDataDeps(path: Path): void {
    let dependencies;
    // intelligently find the dep
    // first look for direct match:
    dependencies = this.state.pathDepTree[path];
    if (dependencies) {
      console.log(chalk.green("Update Triggered by: " + path));
    } else if (!dependencies) {
      // check for wildcard match
      const wildDeps = Object.keys(this.state.wildDepTree);
      for (let pattern of wildDeps) {
        if (micromatch.isMatch(path, "**/" + pattern)) {
          dependencies = this.state.wildDepTree[pattern];
          console.log(chalk.green("Update Triggered by: " + path));
          break;
        }
      }
    }
    if (dependencies) {
      this.updateDeps(dependencies, path);
    } else {
      console.log(chalk.yellow("Info: No dependencies to update for " + path));
    }
  }

  /// -----------------------------------------------------------------------------
  /// updateTemplateDeps
  ///
  /// It's up to generator scripts to tell us which datafiles they'd like to watch
  /// -----------------------------------------------------------------------------
  updateTemplateDeps(templateName: TemplateName) {
    // when a template updates, we need to check its dependencies and also trigger its own
    // generation if it is a page maker
    const deps = {
      ...(this.state.templateDepTree[templateName] || {}),
      [templateName]: true,
    };
    console.log(chalk.green("Update Triggered by: " + templateName));
    this.updateDeps(deps);
  }

  updatGlobalDeps(): void {
    console.log(chalk.green("Update Triggered by preGenerate.js change."));
    this.updateDeps(this.state.globalDeps);
  }
}
