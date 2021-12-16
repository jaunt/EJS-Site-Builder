const Diff2html = require("diff2html");
const { execFile } = require("child_process");

const diff2htmlstyle = `
<!-- CSS -->
<link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />

<!-- Javascripts -->
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
`;

const test = (CliFry) => {
  return new Promise(async function (resolve, reject) {
    const testRun = CliFry(
      {
        name: "Simple Test 1",
        description: "Make sure a simple template outputs properly.",
        timeout: 5000,
      },
      // arguments
      [
        "--input ./templates",
        "--output ./output",
        "--cache ./cache",
        "--noWatch",
      ]
    );

    try {
      await testRun.start(100);
      await testRun.untilStopped(5000);

      // diff -r /home/steve/projects/airfryts/tests/simple/output/index.html /home/steve/projects/airfryts/tests/simple/expected/index.html\n1c1\n< This is to test the most basic page generation: test 1\n\\ No newline at end of file\n---\n> This is to test the most basic page generation: test 12\n
      if (exitCode) {
        // for this test, the cli must end gracefully
        reject("Airfry ended unexpectedly");
      } else {
        //const cmd = "diff
        const child = execFile(
          "diff",
          [
            "--unified",
            "-r",
            testRun.dir + "/output",
            testRun.dir + "/expected",
          ],
          (error, stdout) => {
            if (error) {
              const cmdLength = child.spawnargs.join(" ").length;
              const output = stdout.slice(cmdLength);
              testRun.log(output);
              const diffHtml = Diff2html.html(output, { drawFileList: true });
              testRun.writeFile(
                testRun.dir + "/diff.html",
                diff2htmlstyle + "\n" + diffHtml
              );
              reject("Output does not match expected");
            } else {
              resolve();
            }
          }
        );
      }
    } catch (error) {
      reject("Simple test failed.");
    }
  });
};

module.exports = test;
