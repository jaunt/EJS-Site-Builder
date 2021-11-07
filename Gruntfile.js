const testsDir = "/tests/";
const { spawn, exec } = require("child_process");
const chalk = require("chalk");
const { pipeline } = require("stream");
const { doesNotReject } = require("assert");
const { clearTimeout } = require("timers");
const { getJSDocReadonlyTag } = require("typescript");

module.exports = function (grunt) {
  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON("package.json"),
  });

  grunt.registerTask("build", "build airfry", function () {
    const done = this.async();
    const child = exec("npm run build", (error, stdout, stderr) => {
      if (error) {
        grunt.log.error(`exec error: ${error}`);
        return;
      }
      grunt.log.writeln(`stdout: ${stdout}`);
      if (stderr) {
        grunt.log.error(`stderr: ${stderr}`);
      }
      done();
    });
  });

  grunt.registerTask("test", "test airfry", function (testName) {
    // Force task into async mode and grab a handle to the "done" function.
    const done = this.async();

    const testDir = process.cwd() + testsDir + testName + "/";

    const config = grunt.file.readJSON(testDir + "config.json");

    if (!config) {
      grunt.fail.warn("Test " + testName + " missing config.json");
      return;
    }

    const cmd = process.cwd() + "/lib/cli.js";

    grunt.log.writeln(
      chalk.yellow("Command: node " + cmd + " " + config.args.join(" "))
    );

    const airfry = spawn("node", [cmd, ...config.args], {
      stdio: ["ignore", process.stdout, "pipe"],
      shell: true,
    });

    const timeout = setTimeout(() => {
      airfry.kill("SIGINT");
    }, 1000);

    airfry.stderr.on("data", (data) => {
      grunt.log.error(chalk.red.bold(`${data}`));
    });

    airfry.on("close", (code, signal) => {
      if (signal) {
        grunt.log.writeln(
          `child process terminated due to receipt of signal ${signal}`
        );
      }
    });

    airfry.on("exit", (code) => {
      if (code) {
        grunt.log.writeln(`child process exited with code ${code}`);
      }
      clearTimeout(timeout);
      done();
    });
  });

  grunt.registerTask("all", ["build", "test:simple"]);
};
