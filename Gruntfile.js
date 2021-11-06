module.exports = function (grunt) {
  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON("package.json"),
  });

  grunt.registerTask("asyncfoo", 'My "asyncfoo" task.', function () {
    // Force task into async mode and grab a handle to the "done" function.
    var done = this.async();
    // Run some sync stuff.
    grunt.log.writeln("Processing task...");
    // And some async stuff.

    const doneFunction = (err, result, code) => {
      grunt.log.writeln(err);
      grunt.log.writeln(result);
      grunt.log.writeln(code);
      done();
    };

    grunt.util.spawn(
      {
        cmd: "./lib/cli.js",
        args: ["-nw"],
      },
      doneFunction
    );
  });
};
