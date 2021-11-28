import fs from "fs";
import fspath from "path";
import chalk from "chalk";

/// ----------------------------------------------------------------------------
/// Safety to prevent user from accidently
/// writing files outside the output directory
/// ----------------------------------------------------------------------------
const isRelative = (parent: string, dir: string): Boolean => {
  const relative = fspath.relative(parent, dir);
  return (
    Boolean(relative == "") ||
    (Boolean(relative) &&
      !relative.startsWith("..") &&
      !fspath.isAbsolute(relative))
  );
};

/// -----------------------------------------------------------------------------
/// Scanning for files
/// -----------------------------------------------------------------------------
const getAllFiles = function (
  dirPath: string,
  arrayOfFiles?: string[]
): string[] {
  const resDir = fspath.resolve(dirPath);
  const aof: string[] = arrayOfFiles || [];
  try {
    const files = fs.readdirSync(resDir);
    files.forEach(function (file) {
      if (fs.statSync(resDir + "/" + file).isDirectory()) {
        arrayOfFiles = getAllFiles(resDir + "/" + file, aof);
      } else {
        aof.push(resDir + "/" + file);
      }
    });
  } catch (error) {
    arrayOfFiles = [];
  }
  return aof;
};

/// -----------------------------------------------------------------------------
/// Simple pinger until done is called
/// -----------------------------------------------------------------------------
class Pinger {
  readonly timeout;
  readonly id: string;
  private _done: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private ping: (id: string) => void;
  constructor(id: string, func: (id: string) => void, timeout: number = 2000) {
    this.id = id;
    this.ping = func;
    this._startTimer();
    this.timeout = timeout;
  }
  private _startTimer() {
    this.timer = setTimeout(() => {
      this.ping(this.id);
      if (!this._done) this._startTimer();
    }, this.timeout);
  }
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
  restart() {
    this.stop();
    this._startTimer();
  }
}

const _formatLog = (prefix: string, useChalk = chalk.green, ...args: any) => {
  for (let arg of args) {
    let txt;
    if (typeof arg === "string" || (arg as any) instanceof String) {
      txt = arg;
    } else {
      txt = JSON.stringify(arg, null, 2);
    }
    console.log(useChalk(prefix + chalk.bgWhite(arg)));
  }
};
const makeLoggers = (
  prefix: string,
  errorFlag: string = "[ERROR] ",
  goodColor = chalk.green,
  badColor = chalk.red
) => {
  return {
    log: _formatLog.bind(null, prefix, goodColor),
    logError: _formatLog.bind(null, prefix + errorFlag, badColor),
  };
};

export { isRelative, getAllFiles, Pinger, makeLoggers };
