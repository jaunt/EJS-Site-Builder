const { exec } = require("child_process");
const controller = new AbortController();
const { signal } = controller;

const testsDir = "/tests/";

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
    // Run some sync stuff.
    grunt.log.writeln("Processing task...");
    // And some async stuff.

    const testDir = process.cwd() + testsDir + testName + "/";

    const config = grunt.file.readJSON(testDir + "config.json");

    if (!config) {
      grunt.fail.warn("Test " + testName + " missing config.json");
      return;
    }

    const cmd =
      process.cwd() +
      "/lib/cli.js " +
      (config.args ? config.args.join(" ") : "");

    grunt.log.writeln(cmd);
    grunt.log.writeln(testDir);

    const timeout = setTimeout(() => {
      controller.abort();
    }, 5000);

    const child = exec(
      cmd,
      { signal, cwd: testDir },
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error) {
          grunt.log.error(`exec error: ${error}`);
          return;
        }
        grunt.log.writeln(`stdout: ${stdout}`);
        grunt.log.error(`stderr: ${stderr}`);
        done();
      }
    );
  });

  grunt.registerTask("all", ["build", "test:simple"]);
};
